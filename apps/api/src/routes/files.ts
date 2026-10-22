import type { FastifyPluginAsync } from 'fastify';
import type { ApiResponse, FilePage } from '@bonitashare/shared-types';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db/client.js';
import { files } from '@bonitashare/core/db';
import { thumbUrl } from '@/storage/client.js';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

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
                    or(isNull(files.expiresAt), gt(files.expiresAt, sql`now()`)),
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
};

export default fileRoutes;
