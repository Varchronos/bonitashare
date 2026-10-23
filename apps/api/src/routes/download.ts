import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiResponse } from '@bonitashare/shared-types';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client.js';
import { fileVideos, files, notDeleted } from '@bonitashare/core/db';
import { BUCKET } from '@bonitashare/core/storage';
import { hlsUrl, publicStorage, thumbUrl } from '@/storage/client.js';

const URL_EXPIRY_SECONDS = 60 * 60;

type FileLink = {
    url: string;
    // Null until the worker has made one, or for files that don't get thumbnails.
    thumbnailUrl: string | null;
    filename: string;
    contentType: string | null;
    sizeBytes: number;
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
    const [file] = await db.select().from(files).where(and(eq(files.id, req.params.id), notDeleted()));

    // Same 404 for missing/private/unowned — don't reveal that a private file exists.
    if (!file || file.fileStatus !== 'uploaded' || (!file.isPublic && file.ownerId !== req.userId)) {
        reply.code(404);
        return { file: null, failure: { data: null, error: { message: 'File not found', code: 'FILE_NOT_FOUND' } } } as const;
    }

    if (file.expiresAt && file.expiresAt < new Date()) {
        reply.code(410);
        return { file: null, failure: { data: null, error: { message: 'File has expired', code: 'FILE_EXPIRED' } } } as const;
    }

    return { file, failure: null } as const;
}

// Storage only knows the object key (uploads/<id>), so without this a saved file is named after the
// id. Inline keeps previews and "Open file" working in the browser; filename* carries the real name
// (any script), filename an ASCII fallback for clients that don't read filename* (RFC 6266).
function contentDisposition(filename: string) {
    const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
    const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

// Uploads are stored as binary/octet-stream, which link-preview crawlers won't take as an image or
// play as a video (og:video). Only raster images and plain video containers: they can't carry
// script, unlike SVG or HTML served from the storage domain.
const INLINE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'video/mp4', 'video/webm']);

const downloadRoutes: FastifyPluginAsync = async (fastify) => {
    // Public, but owners can also fetch their own private files.
    fastify.addHook('onRequest', fastify.optionalSession);

    fastify.get<{ Params: { id: string } }>('/download/:id', async (req, reply): Promise<ApiResponse<FileLink>> => {
        const { file, failure } = await findServableFile(req, reply);
        if (!file) return failure;

        const url = await publicStorage.presignedGetObject(BUCKET, file.storageKey, URL_EXPIRY_SECONDS, {
            'response-content-disposition': contentDisposition(file.filename),
            ...(file.contentType && INLINE_MEDIA_TYPES.has(file.contentType) ? { 'response-content-type': file.contentType } : {}),
        });

        return {
            data: {
                url,
                thumbnailUrl: file.thumbKey ? thumbUrl(file.thumbKey) : null,
                filename: file.filename,
                contentType: file.contentType,
                sizeBytes: file.sizeBytes,
            },
            error: null,
        };
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
