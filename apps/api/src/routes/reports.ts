import type { FastifyPluginAsync } from "fastify";
import { REPORT_DETAILS_MAX_LENGTH, type ApiFailure, type ApiResponse, type ReportReason } from "@bonitashare/shared-types";
import { and, eq, isNotNull } from "drizzle-orm";
import { REPORT_REASONS, files, reports, users } from "@bonitashare/core/db";
import { db } from "@/db/client.js";
import { tooManyRequests } from "@/auth/rateLimit.js";
import { fileVisibleToVisitor } from "@/visits/record.js";

const ARTIFACT_ID_MAX_LENGTH = 64;

// The form's reasons (shared-types) and the database's (core) are separate lists; these fail to
// typecheck if they stop matching.
type DbReason = (typeof REPORT_REASONS)[number];
const _formCoversDb: ReportReason = "" as DbReason;
const _dbCoversForm: DbReason = "" as ReportReason;
void _formCoversDb, _dbCoversForm;

const isReason = (value: unknown): value is DbReason =>
    typeof value === "string" && (REPORT_REASONS as readonly string[]).includes(value);

const fail = (code: string, message: string): ApiFailure => ({ data: null, error: { code, message } });

const reportRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook("onRequest", fastify.requireSession);

    // Per account rather than per IP: only signed-in users can report, and the account is what's
    // abusing it if anything is. Checked inside the handler, once requireSession has set userId.
    const reportLimit = fastify.createRateLimit({
        max: 20,
        timeWindow: "1 hour",
        keyGenerator: (req) => `reports:user:${req.userId}`,
    });

    // Served at /api/v1/reports: the report form on a share page. Signed-in users only for now.
    // Reporting the same file again updates the earlier report (reason and details) instead of
    // adding another; its status is left as it is.
    fastify.post<{ Body: { kind?: unknown; id?: unknown; reason?: unknown; details?: unknown } }>(
        "/reports",
        async (req, reply): Promise<ApiResponse<null>> => {
            const userId = req.userId!;
            const { kind, id, reason, details } = req.body ?? {};

            if (kind !== "file") {
                reply.code(400);
                return fail("UNSUPPORTED_ARTIFACT", "Only files can be reported so far");
            }
            if (typeof id !== "string" || !id || id.length > ARTIFACT_ID_MAX_LENGTH) {
                reply.code(400);
                return fail("INVALID_ARTIFACT_ID", "Invalid file id");
            }
            if (!isReason(reason)) {
                reply.code(400);
                return fail("INVALID_REASON", "Choose a reason for the report");
            }
            if (details !== undefined && details !== null && typeof details !== "string") {
                reply.code(400);
                return fail("INVALID_DETAILS", "Invalid details");
            }
            const trimmed = details?.trim() || null;
            if (trimmed && trimmed.length > REPORT_DETAILS_MAX_LENGTH) {
                reply.code(400);
                return fail("INVALID_DETAILS", `Details must be at most ${REPORT_DETAILS_MAX_LENGTH} characters`);
            }

            const [account] = await db
                .select({ id: users.id })
                .from(users)
                .where(and(eq(users.id, userId), isNotNull(users.email)));
            if (!account) {
                reply.code(403);
                return fail("SIGN_IN_REQUIRED", "Log in to report a file");
            }

            const limit = await reportLimit(req);
            if (!limit.isAllowed && limit.isExceeded) return tooManyRequests(reply, limit.ttlInSeconds);

            // Uploaders can't report their own files. Checked on its own so they get a clear answer rather
            // than a 404; it tells them nothing they don't know, since only the owner gets this reply.
            const [own] = await db
                .select({ id: files.id })
                .from(files)
                .where(and(eq(files.id, id), eq(files.ownerId, userId)));
            if (own) {
                reply.code(403);
                return fail("OWN_FILE", "You can't report your own file");
            }

            // Anything else the reporter could open by link. Private, expired, deleted and missing files
            // all answer the same 404, so ids can't be probed this way. fileVisibleToVisitor also excludes
            // the reporter's own files, so this holds even without the check above.
            const [file] = await db
                .select({ id: files.id })
                .from(files)
                .where(and(eq(files.id, id), fileVisibleToVisitor(userId)));
            if (!file) {
                reply.code(404);
                return fail("FILE_NOT_FOUND", "File not found");
            }

            await db
                .insert(reports)
                .values({ fileId: file.id, reporterId: userId, reporterIp: req.ip, reason, details: trimmed })
                .onConflictDoUpdate({
                    // reports_reporter_file_idx, which is partial.
                    target: [reports.reporterId, reports.fileId],
                    targetWhere: isNotNull(reports.fileId),
                    set: { reason, details: trimmed, reporterIp: req.ip },
                });

            return { data: null, error: null };
        },
    );
};

export default reportRoutes;
