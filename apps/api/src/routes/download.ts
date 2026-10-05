import type { FastifyPluginAsync } from 'fastify';
import type { ApiResponse } from '@bonitashare/shared-types';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client.js';
import { files } from '@bonitashare/core/db';
import { BUCKET } from '@bonitashare/core/storage';
import { publicStorage, thumbUrl } from '@/storage/client.js';

const URL_EXPIRY_SECONDS = 60 * 60;

type FileLink = {
    url: string;
    // Null until the worker has made one, or for files that don't get thumbnails.
    thumbnailUrl: string | null;
    filename: string;
    contentType: string | null;
    sizeBytes: number;
};

const downloadRoutes: FastifyPluginAsync = async (fastify) => {
    // Public, but owners can also fetch their own private files.
    fastify.addHook('onRequest', fastify.optionalSession);

    fastify.get<{ Params: { id: string } }>('/download/:id', async (req, reply): Promise<ApiResponse<FileLink>> => {
        const [file] = await db.select().from(files).where(eq(files.id, req.params.id));

        // Same 404 for missing/private/unowned — don't reveal that a private file exists.
        if (!file || file.fileStatus !== 'uploaded' || (!file.isPublic && file.ownerId !== req.userId)) {
            reply.code(404);
            return { data: null, error: { message: 'File not found', code: 'FILE_NOT_FOUND' } };
        }

        if (file.expiresAt && file.expiresAt < new Date()) {
            reply.code(410);
            return { data: null, error: { message: 'File has expired', code: 'FILE_EXPIRED' } };
        }

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
};

export default downloadRoutes;
