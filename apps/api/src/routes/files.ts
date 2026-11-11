import type { FastifyPluginAsync } from 'fastify';
import { quotaMessages, type ApiResponse, type DeletedFile, type FilePage, type IncompleteUpload } from '@bonitashare/shared-types';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db/client.js';
import { fileDeletions, fileTakedowns, fileVideos, files, notDeleted } from '@bonitashare/core/db';
import { TRANSCODE_HLS_JOB, restoreTranscodeJobId } from '@bonitashare/core/queue';
import { thumbUrl } from '@/storage/client.js';
import { videoProcessingQueue } from '@/queue/client.js';
import { resolveTier } from '@/upload/tier.js';
import { getUsage } from '@/upload/usage.js';
import { uploadProgress } from '@/upload/tusServer.js';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

// How long a deleted file can be restored before the worker's purge sweep removes it for good.
const RESTORE_WINDOW = sql`interval '1 day'`;
// The deleted list isn't paginated: a day's worth of deletes is small, and past this the oldest drop off.
const MAX_DELETED_LISTED = 200;

const notFound = { data: null, error: { message: 'File not found', code: 'FILE_NOT_FOUND' } } as const;

// Taken down as removed or held: out of the owner's hands entirely, so off their lists and beyond delete
// or restore. Hidden ones stay: the owner can still see them (the share page says they're taken down).
const ownerCanManage = () =>
    sql`NOT EXISTS (SELECT 1 FROM ${fileTakedowns} WHERE ${fileTakedowns.fileId} = ${files.id} AND ${fileTakedowns.state} <> 'hidden')`;

// Expiring files (anonymous uploads) never outlive their expiry by being deleted.
const notExpired = () => or(isNull(files.expiresAt), gt(files.expiresAt, sql`now()`));

// The cursor is the last row's (uploaded_at, id). uploaded_at goes through as Postgres's own text
// form, not a JS Date: Dates stop at milliseconds and the column keeps microseconds, so a
// round-tripped Date would skip or repeat rows that share a millisecond.
function encodeCursor(uploadedAt: string, id: string) {
    return Buffer.from(JSON.stringify([uploadedAt, id])).toString('base64url');
}

function decodeCursor(cursor: string): [string, string] | null {
    try {
        const value = JSON.parse(Buffer.from(cursor, 'base64url').toString());
        if (Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === 'string')) {
            return value as [string, string];
        }
    } catch {}
    return null;
}

// More than this many unfinished uploads at once is unlikely; past it the oldest go unlisted.
const MAX_INCOMPLETE_LISTED = 50;

// The user's unfinished uploads, so ones this browser lost track of (dismissed, another browser,
// cleared site data) can still be continued or removed. Each one costs a storage read for its offset.
// Ones a request is writing to right now are running in another tab or device, so they're left out.
async function listIncomplete(userId: string): Promise<IncompleteUpload[]> {
    const rows = await db
        .select({
            id: files.id,
            filename: files.filename,
            contentType: files.contentType,
            sizeBytes: files.sizeBytes,
            storageKey: files.storageKey,
            createdAt: files.createdAt,
        })
        .from(files)
        .where(and(eq(files.ownerId, userId), eq(files.fileStatus, 'uploading'), notExpired(), notDeleted(), ownerCanManage()))
        .orderBy(desc(files.createdAt))
        .limit(MAX_INCOMPLETE_LISTED);

    const listed = await Promise.all(
        rows.map(async ({ storageKey, createdAt, ...row }) => {
            const { active, offset, lastModified } = await uploadProgress(storageKey);
            if (active) return null;
            return { ...row, bytesUploaded: offset, lastModified, createdAt: createdAt.toISOString() };
        }),
    );
    return listed.filter((upload) => upload !== null);
}

const fileRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook('onRequest', fastify.requireSession);

    // Served at /api/v1/files: the upload page's list of finished uploads, newest first. The server is
    // the only copy of this list — the browser keeps just the uploads still in progress.
    fastify.get<{ Querystring: { cursor?: string; limit?: string } }>('/files', async (req, reply): Promise<ApiResponse<FilePage>> => {
        // requireSession has set it, or already replied 401.
        const userId = req.userId!;
        const limit = Math.min(Math.max(Number(req.query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

        const cursor = req.query.cursor ? decodeCursor(req.query.cursor) : null;
        if (req.query.cursor && !cursor) {
            reply.code(400);
            return { data: null, error: { message: 'Invalid cursor', code: 'INVALID_CURSOR' } };
        }

        const rows = await db
            .select({
                id: files.id,
                filename: files.filename,
                contentType: files.contentType,
                sizeBytes: files.sizeBytes,
                isPublic: files.isPublic,
                thumbKey: files.thumbKey,
                expiresAt: files.expiresAt,
                uploadedAt: files.uploadedAt,
                // For the cursor only; see encodeCursor.
                uploadedAtText: sql<string>`${files.uploadedAt}::text`,
            })
            .from(files)
            .where(
                and(
                    eq(files.ownerId, userId),
                    eq(files.fileStatus, 'uploaded'),
                    notExpired(),
                    notDeleted(),
                    ownerCanManage(),
                    cursor ? sql`(${files.uploadedAt}, ${files.id}) < (${cursor[0]}::timestamptz, ${cursor[1]})` : undefined,
                ),
            )
            // NULLS LAST to match files_owner_uploaded_idx; plain DESC means NULLS FIRST, which can't use it.
            .orderBy(sql`${files.uploadedAt} DESC NULLS LAST`, sql`${files.id} DESC NULLS LAST`)
            // One extra row says whether there's another page, without a count query.
            .limit(limit + 1);

        const page = rows.slice(0, limit);
        const last = page.at(-1);

        return {
            data: {
                files: page.map(({ thumbKey, uploadedAt, uploadedAtText, expiresAt, ...file }) => ({
                    ...file,
                    thumbnailUrl: thumbKey ? thumbUrl(thumbKey) : null,
                    // Never null here: fileStatus 'uploaded' is set together with uploadedAt.
                    uploadedAt: uploadedAt!.toISOString(),
                    expiresAt: expiresAt?.toISOString() ?? null,
                })),
                nextCursor: rows.length > limit && last ? encodeCursor(last.uploadedAtText, last.id) : null,
            },
            error: null,
        };
    });

    // Served at /api/v1/files/incomplete: fetched by the upload page after it loads, so the storage
    // reads it costs never hold up the page.
    fastify.get('/files/incomplete', async (req): Promise<ApiResponse<IncompleteUpload[]>> => {
        return { data: await listIncomplete(req.userId!), error: null };
    });

    // Served at /api/v1/files/:id: a soft delete. The file 404s and leaves the storage quota at once
    // (weekly usage stays spent), and can be restored until purge_after; after that the worker's purge
    // sweep removes its objects and rows. In-flight processing is left to notice the deletion itself.
    fastify.delete<{ Params: { id: string } }>('/files/:id', async (req, reply): Promise<ApiResponse<null>> => {
        const userId = req.userId!;
        const [file] = await db
            .select({ id: files.id, expiresAt: files.expiresAt })
            .from(files)
            // Unfinished uploads are cancelled through tus instead, which also releases the reservation.
            .where(and(eq(files.id, req.params.id), eq(files.ownerId, userId), eq(files.fileStatus, 'uploaded'), ownerCanManage()));
        // Someone else's file answers the same as a missing one, so ids can't be probed for existence.
        if (!file) {
            reply.code(404);
            return notFound;
        }

        // The window ends at the file's expiry if that comes first: a restore can't bring back an expired
        // file, so there's nothing to keep it for. LEAST skips the NULL of a file that never expires, and an
        // already-expired file gets a purge_after in the past, so the next sweep removes it.
        // Deleting twice keeps the first window rather than extending it.
        await db
            .insert(fileDeletions)
            .values({ fileId: file.id, purgeAfter: sql`least(now() + ${RESTORE_WINDOW}, ${file.expiresAt}::timestamptz)` })
            .onConflictDoNothing();
        return { data: null, error: null };
    });

    // Served at /api/v1/files/deleted: the recently deleted page, newest delete first.
    fastify.get('/files/deleted', async (req): Promise<ApiResponse<DeletedFile[]>> => {
        const userId = req.userId!;
        const rows = await db
            .select({
                id: files.id,
                filename: files.filename,
                contentType: files.contentType,
                sizeBytes: files.sizeBytes,
                thumbKey: files.thumbKey,
                deletedAt: fileDeletions.deletedAt,
                purgeAfter: fileDeletions.purgeAfter,
            })
            .from(fileDeletions)
            .innerJoin(files, eq(files.id, fileDeletions.fileId))
            // Past purge_after it can't be restored any more, even if the sweep hasn't reached it yet.
            // Expiry is checked again here and on restore, not just trusted from purge_after: an expiry
            // that changes after the delete (cleared on signup, say) doesn't move purge_after with it.
            .where(and(eq(files.ownerId, userId), gt(fileDeletions.purgeAfter, sql`now()`), notExpired(), ownerCanManage()))
            .orderBy(desc(fileDeletions.deletedAt))
            .limit(MAX_DELETED_LISTED);

        return {
            data: rows.map(({ thumbKey, deletedAt, purgeAfter, ...file }) => ({
                ...file,
                thumbnailUrl: thumbKey ? thumbUrl(thumbKey) : null,
                deletedAt: deletedAt.toISOString(),
                purgeAfter: purgeAfter.toISOString(),
            })),
            error: null,
        };
    });

    // Served at /api/v1/files/:id/restore: undoes a soft delete, if the window is still open and the
    // file fits the storage quota again.
    fastify.post<{ Params: { id: string } }>('/files/:id/restore', async (req, reply): Promise<ApiResponse<null>> => {
        const userId = req.userId!;
        const tier = await resolveTier(userId);

        const outcome = await db.transaction(async (tx) => {
            // The same per-user lock as upload creates, so a restore and an upload can't both fit in the same space.
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);

            const [file] = await tx
                .select({ id: files.id, sizeBytes: files.sizeBytes, expiresAt: files.expiresAt })
                .from(fileDeletions)
                .innerJoin(files, eq(files.id, fileDeletions.fileId))
                .where(and(eq(files.id, req.params.id), eq(files.ownerId, userId), gt(fileDeletions.purgeAfter, sql`now()`), ownerCanManage()))
                // Holds off a purge that's about to start on it until this commits.
                .for('update');
            if (!file) return 'not-found' as const;
            // Restoring would only bring back a link that answers 410; the purge sweep removes it instead.
            if (file.expiresAt && file.expiresAt <= new Date()) return 'expired' as const;

            const { storage } = await getUsage(userId, tier, tx);
            if (storage.limit !== null && storage.used + file.sizeBytes > storage.limit) {
                return { full: quotaMessages.storageFull(storage.limit - storage.used, storage.limit) };
            }

            await tx.delete(fileDeletions).where(eq(fileDeletions.fileId, file.id));
            return 'restored' as const;
        });

        if (outcome === 'not-found') {
            reply.code(404);
            return notFound;
        }
        if (outcome === 'expired') {
            reply.code(410);
            return { data: null, error: { message: 'File has expired and can no longer be restored', code: 'FILE_EXPIRED' } };
        }
        if (outcome !== 'restored') {
            reply.code(403);
            return { data: null, error: { message: outcome.full, code: 'STORAGE_FULL' } };
        }

        // A transcode the delete cut short (or never started) left the video 'pending'; queue it again.
        // 'done' already has its HLS, and 'failed' failed on its own, so neither is retried.
        const [video] = await db
            .select({ status: fileVideos.status })
            .from(fileVideos)
            .where(eq(fileVideos.fileId, req.params.id));
        if (video?.status === 'pending') {
            try {
                await videoProcessingQueue.add(TRANSCODE_HLS_JOB, { fileId: req.params.id }, { jobId: restoreTranscodeJobId(req.params.id) });
            } catch (err) {
                // The file is restored and plays from the original either way; only the HLS is missing.
                req.log.error({ err, fileId: req.params.id }, 'could not re-queue transcode after restore');
            }
        }
        return { data: null, error: null };
    });
};

export default fileRoutes;
