import type { FastifyPluginAsync } from "fastify";
import type { AdminReport, AdminReportPage, AdminReportSort, ApiFailure, ApiResponse, ReportReason } from "@bonitashare/shared-types";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { REPORT_REASONS, fileDeletions, fileTakedowns, files, reports, users } from "@bonitashare/core/db";
import { db } from "@/db/client.js";

const PAGE_SIZE = 50;
const MAX_PAGE = 1000;
const MAX_MIN_REPORTS = 10_000;

const isReason = (value: string): value is ReportReason => (REPORT_REASONS as readonly string[]).includes(value);

const fail = (code: string, message: string): ApiFailure => ({ data: null, error: { code, message } });

type Query = { reason?: string; minReports?: string; sort?: string; page?: string };

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
};

export default adminRoutes;
