import { db } from "@/db/client.js";
import { files, uploadUsage, type Db } from "@bonitashare/core/db";
import { TIER_LIMITS, type Tier, type Usage } from "@bonitashare/shared-types";
import { and, eq, gt, isNull, min, ne, or, sql } from "drizzle-orm";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// db itself or an open transaction, so onUploadCreate can check and insert under one lock.
type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function getUsage(userId: string, tier: Tier, executor: Executor = db): Promise<Usage> {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - WEEK_MS);
    const limits = TIER_LIMITS[tier];

    const [[weekly], [storage]] = await Promise.all([
        // Rolling window: each upload stops counting 7 days after it started.
        executor
            .select({
                used: sql<number>`coalesce(sum(${uploadUsage.bytesConsumed}), 0)`.mapWith(Number),
                oldest: min(uploadUsage.createdAt),
            })
            .from(uploadUsage)
            .where(and(eq(uploadUsage.userId, userId), gt(uploadUsage.createdAt, weekAgo))),
        // Files that still exist, unfinished uploads included at their full size.
        executor
            .select({ used: sql<number>`coalesce(sum(${files.sizeBytes}), 0)`.mapWith(Number) })
            .from(files)
            .where(and(
                eq(files.ownerId, userId),
                ne(files.fileStatus, "failed"),
                or(isNull(files.expiresAt), gt(files.expiresAt, now)),
            )),
    ]);

    return {
        tier,
        weekly: {
            used: weekly.used,
            limit: limits.weeklyUploadBytes,
            // When the oldest upload in the window ages out and frees some quota; null if nothing counts.
            nextFreesAt: weekly.oldest ? new Date(weekly.oldest.getTime() + WEEK_MS).toISOString() : null,
        },
        storage: {
            used: storage.used,
            limit: limits.storageBytes,
        },
    };
}
