import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiResponse } from '@bonitashare/shared-types';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client.js';
import { fileVideos, files } from '@bonitashare/core/db';
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
    const [file] = await db.select().from(files).where(eq(files.id, req.params.id));

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

const downloadRoutes: FastifyPluginAsync = async (fastify) => {
    // Public, but owners can also fetch their own private files.
    fastify.addHook('onRequest', fastify.optionalSession);

    fastify.get<{ Params: { id: string } }>('/download/:id', async (req, reply): Promise<ApiResponse<FileLink>> => {
        const { file, failure } = await findServableFile(req, reply);
        if (!file) return failure;

        const url = await publicStorage.presignedGetObject(BUCKET, file.storageKey, URL_EXPIRY_SECONDS);

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
