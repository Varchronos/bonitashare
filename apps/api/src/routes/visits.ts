import type { FastifyPluginAsync } from "fastify";
import { MAX_VISITS, type ApiResponse, type Visit } from "@bonitashare/shared-types";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { artifactVisits, files, users } from "@bonitashare/core/db";
import { db } from "@/db/client.js";
import { thumbUrl } from "@/storage/client.js";
import { fileVisibleToVisitor, recordFileVisits } from "@/visits/record.js";

const ARTIFACT_ID_MAX_LENGTH = 64;

// Visits are only kept here for signed-in users; anonymous ones stay in the browser.
async function isSignedIn(userId: string) {
    const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, userId), isNotNull(users.email)));
    return !!user;
}

const visitRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook("onRequest", fastify.requireSession);

    // Served at /api/v1/visits: the homepage's "Shared with you" for a signed-in user, newest first.
    // Files that stopped being viewable (deleted, expired, made private) drop out here, not on write.
    // Anonymous users get an empty list.
    fastify.get("/visits", async (req): Promise<ApiResponse<Visit[]>> => {
        const userId = req.userId!;
        const rows = await db
            .select({
                id: files.id,
                filename: files.filename,
                contentType: files.contentType,
                sizeBytes: files.sizeBytes,
                thumbKey: files.thumbKey,
                visitedAt: artifactVisits.visitedAt,
            })
            .from(artifactVisits)
            .innerJoin(files, eq(files.id, artifactVisits.fileId))
            .where(and(eq(artifactVisits.userId, userId), fileVisibleToVisitor(userId)))
            // NULLS LAST to match artifact_visits_user_visited_idx.
            .orderBy(sql`${artifactVisits.visitedAt} DESC NULLS LAST`)
            .limit(MAX_VISITS);

        return {
            data: rows.map(({ thumbKey, visitedAt, ...file }) => ({
                kind: "file" as const,
                ...file,
                thumbnailUrl: thumbKey ? thumbUrl(thumbKey) : null,
                visitedAt: visitedAt.toISOString(),
            })),
            error: null,
        };
    });

    // Served at /api/v1/visits: a share page reporting that a signed-in user opened an artifact.
    fastify.post<{ Body: { kind?: unknown; id?: unknown } }>("/visits", async (req, reply): Promise<ApiResponse<null>> => {
        const userId = req.userId!;
        const { kind, id } = req.body ?? {};
        if (typeof id !== "string" || !id || id.length > ARTIFACT_ID_MAX_LENGTH) {
            reply.code(400);
            return { data: null, error: { message: "Invalid artifact id", code: "INVALID_ARTIFACT_ID" } };
        }
        if (kind !== "file") {
            reply.code(400);
            return { data: null, error: { message: "Only file visits are recorded so far", code: "UNSUPPORTED_ARTIFACT" } };
        }
        if (!(await isSignedIn(userId))) {
            reply.code(409);
            return { data: null, error: { message: "Anonymous visits are kept in the browser", code: "ANONYMOUS_SESSION" } };
        }

        // Nothing recorded means the file is the user's own, or not one they can see.
        const recorded = await recordFileVisits(userId, [{ fileId: id, visitedAt: new Date() }]);
        if (!recorded) {
            reply.code(404);
            return { data: null, error: { message: "File not found", code: "FILE_NOT_FOUND" } };
        }
        return { data: null, error: null };
    });

    // Served at /api/v1/visits/:kind/:id: one card's remove button.
    fastify.delete<{ Params: { kind: string; id: string } }>("/visits/:kind/:id", async (req, reply): Promise<ApiResponse<null>> => {
        const { kind, id } = req.params;
        const column = kind === "file" ? artifactVisits.fileId : kind === "album" ? artifactVisits.albumId : null;
        if (!column) {
            reply.code(400);
            return { data: null, error: { message: "Unknown artifact kind", code: "INVALID_ARTIFACT_KIND" } };
        }
        await db.delete(artifactVisits).where(and(eq(artifactVisits.userId, req.userId!), eq(column, id)));
        return { data: null, error: null };
    });

    // Served at /api/v1/visits: the list's Clear button.
    fastify.delete("/visits", async (req): Promise<ApiResponse<null>> => {
        await db.delete(artifactVisits).where(eq(artifactVisits.userId, req.userId!));
        return { data: null, error: null };
    });
};

export default visitRoutes;
