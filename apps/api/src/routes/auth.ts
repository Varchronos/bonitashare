import { MAX_VISITS, TIER_LIMITS, type ApiFailure, type ApiResponse, type LoggedIn, type OtpSent, type SignedUp } from "@bonitashare/shared-types";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { findSession, issueSession, stashAnonymousSession } from "@/plugins/custom/handleSession.js";
import { db } from "@/db/client.js";
import { emailOtps, files, users } from "@bonitashare/core/db";
import { genOtp, otpMatches, OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_MS, OTP_TTL_MS } from "@/auth/otp.js";
import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, verifyNothing, verifyPassword } from "@/auth/password.js";
import { sendEmail } from "@/email/client.js";
import { signupCodeEmail } from "@/email/templates.js";
import { hashToken } from "@/utils/crypto.js";
import { recordFileVisits } from "@/visits/record.js";
import { clearLoginFailures, createAuthLimits, loginLockedFor, recordLoginFailure, tooManyRequests } from "@/auth/rateLimit.js";
import { verifyTurnstile } from "@/auth/turnstile.js";

type SignupBody = { email?: unknown; password?: unknown; displayName?: unknown; turnstileToken?: unknown };

// Must match data-action on the signup form's Turnstile widget (apps/web/src/components/AuthForm.astro).
const TURNSTILE_SIGNUP_ACTION = "signup";


const authRoutes: FastifyPluginAsync = async (fastify) => {
    // signup and login still require an anonymous session, the sessionid will reset once signup/login is complete
    fastify.addHook("onRequest", fastify.requireSession);

    // Per-email limits run inside the handlers, once the email has been checked, so the key is always valid.
    const limits = createAuthLimits(fastify, (req) => normalizeEmail((req.body as { email?: unknown } | undefined)?.email)!);

    // Sends the code for a row just written. If sending fails the row goes too, so the cooldown it
    // started doesn't stop the user from trying again straight away.
    async function deliver(reply: FastifyReply, otpId: string, email: string, code: string): Promise<ApiFailure | null> {
        try {
            await sendEmail(signupCodeEmail(email, code), reply.log);
            return null;
        } catch (err) {
            reply.log.error({ err }, "signup code email failed");
            await db.delete(emailOtps).where(eq(emailOtps.id, otpId));
            return fail(reply, 502, "EMAIL_SEND_FAILED", "Couldn't send the verification email. Try again.");
        }
    }

    // Served at /api/v1/auth/signup: step one. Nothing changes on the user yet; the email and password
    // wait in email_otps until /auth/signup/verify proves the inbox is theirs.
    fastify.post<{ Body: SignupBody }>("/auth/signup", { onRequest: limits.signupSend }, async (req, reply): Promise<ApiResponse<OtpSent>> => {
        const userId = req.userId!;
        const body = req.body ?? {};

        const email = normalizeEmail(body.email);
        if (!email) return fail(reply, 400, "INVALID_EMAIL", "Enter a valid email address");

        const password = body.password;
        if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
            return fail(reply, 400, "INVALID_PASSWORD", `Password must be ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters`);
        }

        const sendWait = await limits.sendBlocked(req);
        if (sendWait) return tooManyRequests(reply, sendWait);

        const displayName = typeof body.displayName === "string" ? body.displayName.trim() || null : null;
        if (displayName && displayName.length > DISPLAY_NAME_MAX_LENGTH) {
            return fail(reply, 400, "INVALID_DISPLAY_NAME", `Name must be at most ${DISPLAY_NAME_MAX_LENGTH} characters`);
        }

        // Before anything that looks up the email, so bots can't use signup to find out who has an account.
        const human = await verifyTurnstile(body.turnstileToken, TURNSTILE_SIGNUP_ACTION, req.ip, req.log);
        if (human === "unavailable") return fail(reply, 503, "TURNSTILE_UNAVAILABLE", "Couldn't run the security check. Try again in a moment.");
        if (human === "invalid") return fail(reply, 400, "TURNSTILE_FAILED", "The security check didn't pass. Try again.");

        const [me] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
        if (me?.email) return fail(reply, 409, "ALREADY_SIGNED_UP", "You're already signed in to an account");

        const [taken] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`);
        if (taken) return fail(reply, 409, "EMAIL_TAKEN", "An account with this email already exists");

        const code = genOtp();
        const now = new Date();
        const row = {
            email,
            purpose: "signup" as const,
            userId,
            codeHash: hashToken(code),
            attempts: 0,
            passwordHash: await hashPassword(password),
            displayName,
            createdAt: now,
            expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        };
        // One row per (email, purpose). Starting over replaces it, which also cancels the old code, but
        // only once the cooldown has passed: the WHERE makes that check and the write one statement.
        const [otp] = await db
            .insert(emailOtps)
            .values(row)
            .onConflictDoUpdate({
                target: [emailOtps.email, emailOtps.purpose],
                set: row,
                where: lt(emailOtps.createdAt, new Date(now.getTime() - OTP_RESEND_COOLDOWN_MS)),
            })
            .returning({ id: emailOtps.id });
        if (!otp) return fail(reply, 429, "OTP_COOLDOWN", "A code was just sent. Wait a minute before asking for another.");

        await limits.spendSend(req);
        const failed = await deliver(reply, otp.id, email, code);
        if (failed) return failed;

        return { data: otpSent(email, row.createdAt, row.expiresAt), error: null };
    });

    // Served at /api/v1/auth/signup/resend: a new code for a signup this browser started, keeping the
    // password it gave. The old code stops working.
    fastify.post<{ Body: { email?: unknown } }>("/auth/signup/resend", { onRequest: limits.signupSend }, async (req, reply): Promise<ApiResponse<OtpSent>> => {
        const userId = req.userId!;
        const email = normalizeEmail(req.body?.email);
        if (!email) return fail(reply, 400, "INVALID_EMAIL", "Enter a valid email address");

        // Each resend gives the code fresh attempts, so this budget is also what caps guesses per address.
        const sendWait = await limits.sendBlocked(req);
        if (sendWait) return tooManyRequests(reply, sendWait);

        const [pending] = await db
            .select({ createdAt: emailOtps.createdAt })
            .from(emailOtps)
            .where(and(eq(emailOtps.email, email), eq(emailOtps.purpose, "signup"), eq(emailOtps.userId, userId)));
        if (!pending) return fail(reply, 404, "OTP_NOT_FOUND", "No signup in progress for this email. Start again.");

        const code = genOtp();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
        const [otp] = await db
            .update(emailOtps)
            .set({ codeHash: hashToken(code), attempts: 0, createdAt: now, expiresAt })
            .where(
                and(
                    eq(emailOtps.email, email),
                    eq(emailOtps.purpose, "signup"),
                    eq(emailOtps.userId, userId),
                    lt(emailOtps.createdAt, new Date(now.getTime() - OTP_RESEND_COOLDOWN_MS)),
                ),
            )
            .returning({ id: emailOtps.id });
        if (!otp) return fail(reply, 429, "OTP_COOLDOWN", "A code was just sent. Wait a minute before asking for another.");

        await limits.spendSend(req);
        const failed = await deliver(reply, otp.id, email, code);
        if (failed) return failed;

        return { data: otpSent(email, now, expiresAt), error: null };
    });

    // Served at /api/v1/auth/signup/verify: step two. A right code upgrades this browser's anonymous
    // user in place — same user_id, so its files and usage stay — and rotates the session token. The
    // browser sends its recently viewed list along (`visits`, from IndexedDB) to move onto the account.
    fastify.post<{ Body: { email?: unknown; code?: unknown; visits?: unknown } }>("/auth/signup/verify", { onRequest: limits.verify }, async (req, reply): Promise<ApiResponse<SignedUp>> => {
        const userId = req.userId!;
        const email = normalizeEmail(req.body?.email);
        const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
        if (!email || !/^\d{6}$/.test(code)) return fail(reply, 400, "OTP_INVALID", "That code isn't right");
        const visits = parseVisits(req.body?.visits);

        type Outcome =
            | { ok: true; displayName: string | null }
            | { ok: false; status: number; code: string; message: string };

        let outcome: Outcome;
        try {
            outcome = await db.transaction(async (tx): Promise<Outcome> => {
                // Locked, so two guesses at once can't both read the same attempt count.
                const [otp] = await tx
                    .select()
                    .from(emailOtps)
                    .where(and(eq(emailOtps.email, email), eq(emailOtps.purpose, "signup")))
                    .for("update");

                // Someone else's signup for this email answers the same as none.
                if (!otp || otp.userId !== userId) {
                    return { ok: false, status: 400, code: "OTP_INVALID", message: "That code isn't right" };
                }
                if (otp.expiresAt <= new Date()) {
                    return { ok: false, status: 400, code: "OTP_EXPIRED", message: "That code has expired. Request a new one." };
                }
                if (!otpMatches(code, otp.codeHash)) {
                    const attempts = otp.attempts + 1;
                    if (attempts >= OTP_MAX_ATTEMPTS) {
                        await tx.delete(emailOtps).where(eq(emailOtps.id, otp.id));
                        return { ok: false, status: 400, code: "OTP_TOO_MANY_ATTEMPTS", message: "Too many wrong codes. Start again." };
                    }
                    await tx.update(emailOtps).set({ attempts }).where(eq(emailOtps.id, otp.id));
                    return { ok: false, status: 400, code: "OTP_INVALID", message: "That code isn't right" };
                }

                // The email IS NULL guard means a user that signed up in the meantime isn't overwritten.
                // A unique violation here means another user verified this email first; see the catch.
                const [upgraded] = await tx
                    .update(users)
                    .set({ email, passwordHash: otp.passwordHash, displayName: otp.displayName })
                    .where(and(eq(users.id, userId), sql`${users.email} IS NULL`))
                    .returning({ id: users.id });
                if (!upgraded) {
                    return { ok: false, status: 409, code: "ALREADY_SIGNED_UP", message: "You're already signed in to an account" };
                }

                // Anonymous uploads were given the anonymous expiry; stretch them to what a free account
                // gets from the same upload time. Never shortened, and a free tier without a cap clears it.
                const freeMax = TIER_LIMITS.free.maxExpirySeconds;
                await tx
                    .update(files)
                    .set({
                        expiresAt:
                            freeMax === null
                                ? null
                                : sql`GREATEST(${files.expiresAt}, ${files.createdAt} + make_interval(secs => ${freeMax}))`,
                    })
                    .where(and(eq(files.ownerId, userId), isNotNull(files.expiresAt)));

                await recordFileVisits(userId, visits, tx);

                // This signup and any other this user started with a different email are done.
                await tx.delete(emailOtps).where(and(eq(emailOtps.userId, userId), eq(emailOtps.purpose, "signup")));
                return { ok: true, displayName: otp.displayName };
            });
        } catch (err) {
            if (!isUniqueViolation(err)) throw err;
            outcome = { ok: false, status: 409, code: "EMAIL_TAKEN", message: "An account with this email already exists" };
        }

        if (!outcome.ok) return fail(reply, outcome.status, outcome.code, outcome.message);

        // A new token for the now-registered user, so a token handed out while anonymous (or planted
        // on this browser) doesn't carry over into the account.
        await issueSession(req, reply, await findSession(req));

        return { data: { userId, email, displayName: outcome.displayName }, error: null };
    });

    // Served at /api/v1/auth/login: swaps this browser's anonymous session for one on the account.
    // The anonymous user and its files are left as they were, its session put aside for logout to
    // restore (see stashAnonymousSession).
    fastify.post<{ Body: { email?: unknown; password?: unknown } }>("/auth/login", { onRequest: limits.login }, async (req, reply): Promise<ApiResponse<LoggedIn>> => {
        const userId = req.userId!;
        const email = normalizeEmail(req.body?.email);
        const password = req.body?.password;
        // One answer for every way it can be wrong, so the form can't be used to find out who has an account.
        const invalid = () => fail(reply, 401, "INVALID_CREDENTIALS", "Email or password is incorrect");
        if (!email || typeof password !== "string" || !password || password.length > PASSWORD_MAX_LENGTH) return invalid();

        const lockedFor = await loginLockedFor(email, req.log);
        if (lockedFor) return tooManyRequests(reply, lockedFor);

        const [me] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
        if (me?.email) return fail(reply, 409, "ALREADY_SIGNED_IN", "You're already signed in to an account");

        const [account] = await db
            .select({ id: users.id, email: users.email, passwordHash: users.passwordHash, displayName: users.displayName })
            .from(users)
            .where(sql`lower(${users.email}) = ${email}`);
        const ok = account?.passwordHash ? await verifyPassword(account.passwordHash, password) : await verifyNothing(password);
        if (!account || !ok) {
            // The failure that hits the limit is already answered with the lockout.
            const lockout = await recordLoginFailure(email, req.log);
            return lockout ? tooManyRequests(reply, lockout) : invalid();
        }

        await clearLoginFailures(email, req.log);
        stashAnonymousSession(req, reply);
        await issueSession(req, reply, null, account.id);

        return { data: { userId: account.id, email: account.email!, displayName: account.displayName }, error: null };
    });
};



 const EMAIL_MAX_LENGTH = 254;
 const DISPLAY_NAME_MAX_LENGTH = 50;
// Deliberately loose: the code we email is the real check that an address works.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


 function fail(reply: FastifyReply, status: number, code: string, message: string): ApiFailure {
    reply.code(status);
    return { data: null, error: { message, code } };
}

// Lowercased and trimmed, so the same inbox is always the same account; see users_email_lower_idx.
 function normalizeEmail(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const email = value.trim().toLowerCase();
    return email.length <= EMAIL_MAX_LENGTH && EMAIL_RE.test(email) ? email : null;
}

 function isUniqueViolation(err: unknown) { // duplicate key violation
    const e = err as { code?: string; cause?: { code?: string } };
    return e?.code === "23505" || e?.cause?.code === "23505";
}

 const otpSent = (email: string, createdAt: Date, expiresAt: Date): OtpSent => ({
    email,
    expiresAt: expiresAt.toISOString(),
    resendAfter: new Date(createdAt.getTime() + OTP_RESEND_COOLDOWN_MS).toISOString(),
});


export default authRoutes;

// The browser's recently viewed list, as sent with signup verify: [{ kind, id, visitedAt (ms) }]. Bad
// entries, and kinds not recorded yet (albums), are dropped rather than failing the signup over a
// convenience list; a time in the future is pulled back to now.
function parseVisits(value: unknown): { fileId: string; visitedAt: Date }[] {
    if (!Array.isArray(value)) return [];
    const now = Date.now();
    const visits: { fileId: string; visitedAt: Date }[] = [];
    for (const v of value.slice(0, MAX_VISITS)) {
        const fileId = v?.id;
        const visitedAt = v?.visitedAt;
        if (v?.kind !== "file") continue;
        if (typeof fileId !== "string" || !fileId || fileId.length > 64) continue;
        if (typeof visitedAt !== "number" || !Number.isFinite(visitedAt) || visitedAt <= 0) continue;
        visits.push({ fileId, visitedAt: new Date(Math.min(visitedAt, now)) });
    }
    return visits;
}
