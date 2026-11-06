import type { FastifyPluginAsync } from "fastify";
import {
    TAKEDOWN_PURGE_OPTIONS,
    TAKEDOWN_SOURCE_OPTIONS,
    type AdminReport,
    type AdminReportPage,
    type AdminReportSort,
    type ApiFailure,
    type ApiResponse,
    type FileTakedown,
    type ManualTakedownSource,
    type ReportReason,
    type TakedownPurge,
    type TakedownState,
} from "@bonitashare/shared-types";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
    REPORT_REASONS,
    TAKEDOWN_STATES,
    fileDeletions,
    fileTakedowns,
    fileVideos,
    files,
    reports,
    takedownEvents,
    users,
} from "@bonitashare/core/db";
import { HLS_BUCKET, THUMB_BUCKET, listKeys, removeObjects } from "@bonitashare/core/storage";
import { PURGE_TAKEDOWN_CONTENT_JOB } from "@bonitashare/core/queue";
import { db } from "@/db/client.js";
import { storage } from "@/storage/client.js";
import { fileProcessingQueue } from "@/queue/client.js";

const PAGE_SIZE = 50;
const MAX_PAGE = 1000;
const MAX_MIN_REPORTS = 10_000;

const isReason = (value: string): value is ReportReason => (REPORT_REASONS as readonly string[]).includes(value);
const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
    typeof value === "string" && (values as readonly string[]).includes(value);

const MANUAL_SOURCES = TAKEDOWN_SOURCE_OPTIONS.map((o) => o.value);
const PURGE_CHOICES = TAKEDOWN_PURGE_OPTIONS.map((o) => o.value);
// Grace period for a removed file before its original is deleted, for appeals.
const PURGE_DELAY = sql`interval '30 days'`;

// The event logged for each state an admin sets.
const ACTION_FOR_STATE = { hidden: "hide", removed: "remove", held: "hold" } as const satisfies Record<TakedownState, string>;

// Thrown inside the takedown transaction to roll it back and answer with this failure.
class TakedownRefused extends Error {
    constructor(readonly status: number, readonly failure: ApiFailure) {
        super(failure.error.message);
    }
}

const fail = (code: string, message: string): ApiFailure => ({ data: null, error: { code, message } });

type Query = { reason?: string; minReports?: string; sort?: string; page?: string };
type TakedownBody = { state?: unknown; reason?: unknown; source?: unknown; purge?: unknown };

const adminRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook("onRequest", fastify.requireAdmin);

    // Served at /api/v1/admin/reports: the moderation table, one row per reported file, with every
    // report on it. Filters: ?reason= keeps files with at least one report of that reason, ?minReports=
    // files with at least that many reports in all. ?sort=newest|oldest orders by the latest report.
    // Offset pages of PAGE_SIZE: the queue is small, and an admin jumping around it is fine with that.
    fastify.get<{ Querystring: Query }>("/admin/reports", async (req, reply): Promise<ApiResponse<AdminReportPage>> => {
        const { reason, minReports, sort = "newest", page } = req.query;

        if (reason && !isReason(reason)) {
            reply.code(400);
            return fail("INVALID_REASON", "Unknown report reason");
        }
        const min = minReports ? Number(minReports) : 1;
        if (!Number.isInteger(min) || min < 1 || min > MAX_MIN_REPORTS) {
            reply.code(400);
            return fail("INVALID_MIN_REPORTS", "minReports must be a whole number of at least 1");
        }
        if (sort !== "newest" && sort !== "oldest") {
            reply.code(400);
            return fail("INVALID_SORT", "sort must be newest or oldest");
        }
        const pageNumber = page ? Number(page) : 1;
        if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > MAX_PAGE) {
            reply.code(400);
            return fail("INVALID_PAGE", "Invalid page");
        }

        const reportCount = sql<number>`count(*)::int`;
        const lastReportedAt = sql<Date>`max(${reports.createdAt})`;
        const order = (sort as AdminReportSort) === "newest" ? desc : asc;

        const rows = await db
            .select({
                fileId: sql<string>`${reports.fileId}`,
                filename: files.filename,
                contentType: files.contentType,
                ownerEmail: users.email,
                deletedByOwner: sql<boolean>`${fileDeletions.fileId} IS NOT NULL`,
                takedownState: fileTakedowns.state,
                reportCount,
                openCount: sql<number>`(count(*) FILTER (WHERE ${reports.status} = 'open'))::int`,
                firstReportedAt: sql<Date>`min(${reports.createdAt})`,
                lastReportedAt,
            })
            .from(reports)
            // Left joins: a purged file, or its owner's deleted account, still leaves its reports listed.
            .leftJoin(files, eq(files.id, reports.fileId))
            .leftJoin(users, eq(users.id, files.ownerId))
            .leftJoin(fileDeletions, eq(fileDeletions.fileId, reports.fileId))
            .leftJoin(fileTakedowns, eq(fileTakedowns.fileId, reports.fileId))
            .where(isNotNull(reports.fileId))
            .groupBy(reports.fileId, files.id, users.id, fileDeletions.fileId, fileTakedowns.fileId)
            .having(and(sql`count(*) >= ${min}`, reason ? sql`bool_or(${reports.reason} = ${reason})` : undefined))
            .orderBy(order(lastReportedAt), order(reports.fileId))
            // One extra row says whether there's another page, without a count query.
            .limit(PAGE_SIZE + 1)
            .offset((pageNumber - 1) * PAGE_SIZE);

        const pageRows = rows.slice(0, PAGE_SIZE);
        const fileIds = pageRows.map((r) => r.fileId);

        const reportRows = fileIds.length
            ? await db
                  .select({
                      id: reports.id,
                      fileId: reports.fileId,
                      reason: reports.reason,
                      details: reports.details,
                      status: reports.status,
                      reporterEmail: users.email,
                      createdAt: reports.createdAt,
                  })
                  .from(reports)
                  .leftJoin(users, eq(users.id, reports.reporterId))
                  .where(inArray(reports.fileId, fileIds))
                  .orderBy(desc(reports.createdAt))
            : [];

        const byFile = new Map<string, AdminReport[]>();
        for (const { fileId, createdAt, ...r } of reportRows) {
            const list = byFile.get(fileId!) ?? [];
            list.push({ ...r, createdAt: createdAt.toISOString() });
            byFile.set(fileId!, list);
        }

        return {
            data: {
                files: pageRows.map((row) => {
                    const fileReports = byFile.get(row.fileId) ?? [];
                    const counts = new Map<ReportReason, number>();
                    for (const r of fileReports) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
                    return {
                        ...row,
                        firstReportedAt: new Date(row.firstReportedAt).toISOString(),
                        lastReportedAt: new Date(row.lastReportedAt).toISOString(),
                        reasons: [...counts].map(([r, count]) => ({ reason: r, count })).sort((a, b) => b.count - a.count),
                        reports: fileReports,
                    };
                }),
                page: pageNumber,
                hasNextPage: rows.length > PAGE_SIZE,
            },
            error: null,
        };
    });

    // Served at /api/v1/admin/files/:id/takedown: a manual takedown, or a change to an existing one.
    //   hidden:  only the owner and admins can open it; nothing is deleted.
    //   removed: only admins can open it; the worker deletes its content once purge_content_after passes.
    //   held:    only admins can open it, and it's never purged; its thumbnail and HLS output are deleted now.
    // Any open reports on the file are marked actioned. The files row always stays: file_takedowns
    // references it, and the purge sweeps skip taken-down files.
    fastify.post<{ Params: { id: string }; Body: TakedownBody }>(
        "/admin/files/:id/takedown",
        async (req, reply): Promise<ApiResponse<FileTakedown>> => {
            const adminId = req.userId!;
            const fileId = req.params.id;
            const { state, reason, source, purge } = req.body ?? {};

            if (!oneOf(TAKEDOWN_STATES, state)) {
                reply.code(400);
                return fail("INVALID_STATE", "state must be hidden, removed or held");
            }
            if (!oneOf(REPORT_REASONS, reason)) {
                reply.code(400);
                return fail("INVALID_REASON", "Unknown reason");
            }
            if (!oneOf<ManualTakedownSource>(MANUAL_SOURCES, source)) {
                reply.code(400);
                return fail("INVALID_SOURCE", "source must be admin, legal or copyright");
            }
            if (state === "removed" && !oneOf<TakedownPurge>(PURGE_CHOICES, purge)) {
                reply.code(400);
                return fail("INVALID_PURGE", "purge must be immediate or 30d for a removed file");
            }

            let takedown: FileTakedown;
            try {
                takedown = await db.transaction(async (tx) => {
                    // Locks the file, so two admins acting at once go one after the other.
                    const [file] = await tx
                        .select({
                            id: files.id,
                            ownerId: files.ownerId,
                            ownerEmail: users.email,
                            thumbKey: files.thumbKey,
                            hlsPrefix: fileVideos.hlsPrefix,
                        })
                        .from(files)
                        .leftJoin(users, eq(users.id, files.ownerId))
                        .leftJoin(fileVideos, eq(fileVideos.fileId, files.id))
                        .where(eq(files.id, fileId))
                        .for("update", { of: files });
                    if (!file) throw new TakedownRefused(404, fail("FILE_NOT_FOUND", "File not found"));

                    const [current] = await tx
                        .select({ contentPurgedAt: fileTakedowns.contentPurgedAt })
                        .from(fileTakedowns)
                        .where(eq(fileTakedowns.fileId, fileId));
                    if (current?.contentPurgedAt) {
                        throw new TakedownRefused(409, fail("CONTENT_PURGED", "This file's content has already been deleted"));
                    }

                    // Held: the original stays as evidence, but the derived copies go. Storage first, inside the
                    // transaction, so a failed delete rolls everything back and the admin can retry.
                    if (state === "held") {
                        if (file.thumbKey) await removeObjects(storage, THUMB_BUCKET, [file.thumbKey]);
                        if (file.hlsPrefix) await removeObjects(storage, HLS_BUCKET, await listKeys(storage, HLS_BUCKET, `${file.hlsPrefix}/`));
                        await tx.update(files).set({ thumbKey: null }).where(eq(files.id, fileId));
                        await tx.delete(fileVideos).where(eq(fileVideos.fileId, fileId));
                    }

                    const purgeContentAfter =
                        state === "removed" ? (purge === "immediate" ? sql`now()` : sql`now() + ${PURGE_DELAY}`) : null;

                    const [row] = await tx
                        .insert(fileTakedowns)
                        .values({
                            fileId,
                            state,
                            reason,
                            source,
                            ownerIdSnapshot: file.ownerId,
                            ownerEmailSnapshot: file.ownerEmail,
                            purgeContentAfter,
                        })
                        .onConflictDoUpdate({
                            target: fileTakedowns.fileId,
                            set: {
                                state,
                                reason,
                                source,
                                purgeContentAfter,
                                updatedAt: sql`now()`,
                                // Keep the first snapshot: by a later change the owner may have deleted their account.
                                ownerIdSnapshot: sql`coalesce(${fileTakedowns.ownerIdSnapshot}, excluded.owner_id_snapshot)`,
                                ownerEmailSnapshot: sql`coalesce(${fileTakedowns.ownerEmailSnapshot}, excluded.owner_email_snapshot)`,
                            },
                        })
                        .returning({ state: fileTakedowns.state, reason: fileTakedowns.reason, purgeContentAfter: fileTakedowns.purgeContentAfter });

                    await tx.insert(takedownEvents).values({
                        fileId,
                        action: ACTION_FOR_STATE[state],
                        actorId: adminId,
                        note: `reason=${reason} source=${source}${state === "removed" ? ` purge=${purge}` : ""}`,
                    });

                    await tx
                        .update(reports)
                        .set({ status: "actioned", resolvedAt: sql`now()`, resolvedBy: adminId })
                        .where(and(eq(reports.fileId, fileId), eq(reports.status, "open")));

                    return { ...row!, purgeContentAfter: row!.purgeContentAfter?.toISOString() ?? null };
                });
            } catch (err) {
                if (err instanceof TakedownRefused) {
                    reply.code(err.status);
                    return err.failure;
                }
                req.log.error({ err, fileId }, "takedown failed");
                reply.code(502);
                return fail("TAKEDOWN_FAILED", "Couldn't apply the takedown. Nothing was changed; try again.");
            }

            // An immediate purge shouldn't wait up to a whole sweep interval. If this add is lost, the
            // scheduled sweep picks the file up anyway.
            if (state === "removed" && purge === "immediate") {
                await fileProcessingQueue
                    .add(PURGE_TAKEDOWN_CONTENT_JOB, {}, { attempts: 1, removeOnComplete: true, removeOnFail: { count: 50 } })
                    .catch((err) => req.log.warn({ err }, "could not start the takedown purge early"));
            }

            return { data: takedown, error: null };
        },
    );
};

export default adminRoutes;
