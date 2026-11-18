import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiResponse, FileTakedown } from '@bonitashare/shared-types';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client.js';
import { fileTakedowns, fileVideos, files, notDeleted } from '@bonitashare/core/db';
import { isAdminUser } from '@/plugins/custom/handleSession.js';
import { BUCKET } from '@bonitashare/core/storage';
import { hlsUrl, publicStorage, storage, thumbUrl } from '@/storage/client.js';

const URL_EXPIRY_SECONDS = 60 * 60;

type FileLink = {
    // Opens in the browser: previews, og:image, /f/<id>/raw.
    url: string;
    // Saves to disk instead of opening, for the download button.
    downloadUrl: string;
    // Null until the worker has made one, or for files that don't get thumbnails.
    thumbnailUrl: string | null;
    filename: string;
    contentType: string | null;
    sizeBytes: number;
    // Whether the viewer uploaded it. The share page keeps a recently-viewed list of other people's files.
    isOwner: boolean;
    // When the upload finished (ISO). Only sent to the owner and admins; null for everyone else.
    uploadedAt: string | null;
    // Only the owner and admins are told; anyone else can't open a taken-down file at all.
    takedown: FileTakedown | null;
};

type FileVideo = {
    status: 'pending' | 'done' | 'failed';
    // Master playlist; null until the transcode is done.
    hlsUrl: string | null;
    durationMs: number | null;
    width: number | null;
    height: number | null;
};

// The checks every route serving a file shares. Replies with the failure itself and returns null,
// so callers just return what this gives back when there's no file.
async function findServableFile(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    // Soft-deleted files 404 for everyone, the owner included; they're restored from the deleted list.
    const [row] = await db
        .select({
            file: files,
            takedownState: fileTakedowns.state,
            takedownReason: fileTakedowns.reason,
            purgeContentAfter: fileTakedowns.purgeContentAfter,
            contentPurgedAt: fileTakedowns.contentPurgedAt,
        })
        .from(files)
        .leftJoin(fileTakedowns, eq(fileTakedowns.fileId, files.id))
        .where(and(eq(files.id, req.params.id), notDeleted()));
    const file = row?.file;
    const isOwner = !!file && req.userId !== null && file.ownerId === req.userId;

    // Same 404 for missing/private/unowned — don't reveal that a private file exists.
    if (!file || file.fileStatus !== 'uploaded' || (!file.isPublic && !isOwner)) {
        reply.code(404);
        return { file: null, failure: { data: null, error: { message: 'File not found', code: 'FILE_NOT_FOUND' } } } as const;
    }

    if (file.expiresAt && file.expiresAt < new Date()) {
        reply.code(410);
        return { file: null, failure: { data: null, error: { message: 'File has expired', code: 'FILE_EXPIRED' } } } as const;
    }

    // Taken down: hidden files stay open to their owner and admins, removed and held ones to admins only,
    // and once a removed file's content is purged there's nothing left for anyone.
    let takedown: FileTakedown | null = null;
    if (row.takedownState) {
        const allowed =
            !row.contentPurgedAt && ((row.takedownState === 'hidden' && isOwner) || (await isAdminUser(req.userId)));
        if (!allowed) {
            reply.code(410);
            return { file: null, failure: { data: null, error: { message: 'This file was taken down', code: 'FILE_TAKEN_DOWN' } } } as const;
        }
        takedown = {
            state: row.takedownState,
            reason: row.takedownReason!,
            purgeContentAfter: row.purgeContentAfter?.toISOString() ?? null,
        };
    }

    return { file, isOwner, takedown, failure: null } as const;
}

// Storage only knows the object key (uploads/<id>), so without this a saved file is named after the
// id. Inline keeps previews working in the browser; attachment makes it save the file instead.
// filename* carries the real name (any script), filename an ASCII fallback for clients that don't
// read filename* (RFC 6266).
function contentDisposition(type: 'inline' | 'attachment', filename: string) {
    const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
    const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

// Uploads are stored as binary/octet-stream, which link-preview crawlers won't take as an image or
// play as a video (og:video), and which an iframe downloads instead of showing (the share page's PDF
// viewer). Only raster images, plain video containers and PDF: unlike SVG or HTML, they can't run
// script on the storage domain. PDF script runs only inside the browser's sandboxed PDF viewer.
const INLINE_MEDIA_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/avif',
    'video/mp4',
    'video/webm',
    'application/pdf',
]);

type FileText = {
    text: string;
    // The file is longer than what's in `text`, which is its first MAX_TEXT_PREVIEW_BYTES.
    truncated: boolean;
};

// The share page's viewer only draws the lines on screen, so this mainly bounds the response and the
// browser's memory. Bigger files show their start and a note to download the rest.
const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;

// UTF-8 text, or null for anything that isn't (binary, another encoding). A read cut off mid-file can
// end partway through a character, so up to 3 trailing bytes are dropped before giving up on it.
function decodeText(bytes: Buffer, truncated: boolean): string | null {
    // A NUL byte almost never appears in text and almost always does in binary formats.
    if (bytes.includes(0)) return null;
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (let drop = 0; drop <= (truncated ? 3 : 0); drop++) {
        try {
            return decoder.decode(bytes.subarray(0, bytes.length - drop));
        } catch {
            // Try again with one byte fewer.
        }
    }
    return null;
}

const downloadRoutes: FastifyPluginAsync = async (fastify) => {
    // Public, but owners can also fetch their own private files.
    fastify.addHook('onRequest', fastify.optionalSession);

    fastify.get<{ Params: { id: string } }>('/download/:id', async (req, reply): Promise<ApiResponse<FileLink>> => {
        const { file, isOwner, takedown, failure } = await findServableFile(req, reply);
        if (!file) return failure;

        // isAdminUser answers signed-out visitors without a query, so anonymous views don't pay for this.
        const canSeeUploadDate = isOwner || (await isAdminUser(req.userId));

        // With S3_REGION set, signing is local (no request to storage), so two URLs cost nothing extra.
        const [url, downloadUrl] = await Promise.all([
            publicStorage.presignedGetObject(BUCKET, file.storageKey, URL_EXPIRY_SECONDS, {
                'response-content-disposition': contentDisposition('inline', file.filename),
                ...(file.contentType && INLINE_MEDIA_TYPES.has(file.contentType) ? { 'response-content-type': file.contentType } : {}),
            }),
            // octet-stream as well as attachment, so no browser tries to render it.
            publicStorage.presignedGetObject(BUCKET, file.storageKey, URL_EXPIRY_SECONDS, {
                'response-content-disposition': contentDisposition('attachment', file.filename),
                'response-content-type': 'application/octet-stream',
            }),
        ]);

        return {
            data: {
                url,
                downloadUrl,
                thumbnailUrl: file.thumbKey ? thumbUrl(file.thumbKey) : null,
                filename: file.filename,
                contentType: file.contentType,
                sizeBytes: file.sizeBytes,
                isOwner,
                uploadedAt: canSeeUploadDate ? (file.uploadedAt ?? file.createdAt).toISOString() : null,
                takedown,
            },
            error: null,
        };
    });

    // The start of a text file, for the share page's code view. Read here with the internal storage client
    // rather than by the web server from the presigned URL, which points at the public endpoint.
    fastify.get<{ Params: { id: string } }>('/download/:id/text', async (req, reply): Promise<ApiResponse<FileText>> => {
        const { file, failure } = await findServableFile(req, reply);
        if (!file) return failure;

        const truncated = file.sizeBytes > MAX_TEXT_PREVIEW_BYTES;
        let bytes = Buffer.alloc(0);
        // A length of 0 would mean "to the end", so an empty file isn't read at all.
        if (file.sizeBytes > 0) {
            const stream = await storage.getPartialObject(BUCKET, file.storageKey, 0, Math.min(file.sizeBytes, MAX_TEXT_PREVIEW_BYTES));
            const chunks: Buffer[] = [];
            for await (const chunk of stream) chunks.push(chunk as Buffer);
            bytes = Buffer.concat(chunks);
        }

        const text = decodeText(bytes, truncated);
        if (text === null) {
            reply.code(415);
            return { data: null, error: { message: 'This file is not UTF-8 text', code: 'NOT_TEXT' } };
        }
        return { data: { text, truncated }, error: null };
    });

    // Separate from /download/:id so non-video files never pay for the extra query.
    fastify.get<{ Params: { id: string } }>('/download/:id/video', async (req, reply): Promise<ApiResponse<FileVideo>> => {
        const { file, failure } = await findServableFile(req, reply);
        if (!file) return failure;

        const [video] = await db.select().from(fileVideos).where(eq(fileVideos.fileId, file.id));
        // Not a video, or uploaded before transcoding existed: the page plays the original instead.
        if (!video) {
            reply.code(404);
            return { data: null, error: { message: 'No streamable version of this file', code: 'VIDEO_NOT_FOUND' } };
        }

        return {
            data: {
                status: video.status,
                hlsUrl: video.status === 'done' && video.masterKey ? hlsUrl(video.masterKey) : null,
                durationMs: video.durationMs,
                width: video.width,
                height: video.height,
            },
            error: null,
        };
    });
};

export default downloadRoutes;
