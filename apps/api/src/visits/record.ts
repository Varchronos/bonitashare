import { db } from "@/db/client.js";
import { artifactVisits, files, notDeleted, notTakenDown, type Db } from "@bonitashare/core/db";
import { MAX_VISITS } from "@bonitashare/shared-types";
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";

// db itself or an open transaction, so signup can move the browser's visits in with the upgrade.
type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

// A file that belongs on someone's "Shared with you": one anybody with the link can open (so not taken
// down), that isn't their own (those are under their uploads). The same rules GET /visits reads back with.
export const fileVisibleToVisitor = (userId: string) =>
    and(
        eq(files.isPublic, true),
        eq(files.fileStatus, "uploaded"),
        sql`${files.ownerId} IS DISTINCT FROM ${userId}`,
        or(isNull(files.expiresAt), gt(files.expiresAt, sql`now()`)),
        notDeleted(),
        notTakenDown(),
    );

// Records file visits for a signed-in user: one row per file, a revisit only ever moving it later,
// then keeps the user's newest MAX_VISITS artifacts. Files that don't qualify are skipped rather than
// failing the lot, since signup sends whatever the browser had. Returns how many were recorded.
// Albums get a recordAlbumVisits beside this once they have pages and visibility rules.
export async function recordFileVisits(userId: string, visits: { fileId: string; visitedAt: Date }[], executor: Executor = db) {
    if (visits.length === 0) return 0;

    const ids = [...new Set(visits.map((v) => v.fileId))];
    const allowed = await executor
        .select({ id: files.id })
        .from(files)
        .where(and(inArray(files.id, ids), fileVisibleToVisitor(userId)));
    const allowedIds = new Set(allowed.map((f) => f.id));

    // Latest per file, in case the same file came twice.
    const latest = new Map<string, Date>();
    for (const v of visits) {
        if (!allowedIds.has(v.fileId)) continue;
        const seen = latest.get(v.fileId);
        if (!seen || v.visitedAt > seen) latest.set(v.fileId, v.visitedAt);
    }
    if (latest.size === 0) return 0;

    await executor
        .insert(artifactVisits)
        .values([...latest].map(([fileId, visitedAt]) => ({ userId, fileId, visitedAt })))
        .onConflictDoUpdate({
            // artifact_visits_user_file_idx, which is partial.
            target: [artifactVisits.userId, artifactVisits.fileId],
            targetWhere: sql`${artifactVisits.fileId} IS NOT NULL`,
            set: { visitedAt: sql`GREATEST(${artifactVisits.visitedAt}, excluded.visited_at)` },
        });

    await trimVisits(userId, executor);
    return latest.size;
}

// Keeps a user's newest MAX_VISITS artifacts, files and albums together.
async function trimVisits(userId: string, executor: Executor) {
    // NULLS LAST to match artifact_visits_user_visited_idx.
    await executor.delete(artifactVisits).where(
        and(
            eq(artifactVisits.userId, userId),
            sql`${artifactVisits.id} NOT IN (
                SELECT ${artifactVisits.id} FROM ${artifactVisits}
                WHERE ${artifactVisits.userId} = ${userId}
                ORDER BY ${artifactVisits.visitedAt} DESC NULLS LAST
                LIMIT ${MAX_VISITS}
            )`,
        ),
    );
}
