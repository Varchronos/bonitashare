import type { FastifyBaseLogger } from "fastify";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
// Token length cap from Cloudflare's docs; anything longer isn't a real token.
const MAX_TOKEN_LENGTH = 2048;

export type TurnstileResult = "ok" | "invalid" | "unavailable";

// Checks a Turnstile token with Cloudflare. Tokens are single-use and last 5 minutes, so the form needs a
// fresh one for every submit. `action` must match the widget's data-action, so a token solved on another
// form can't be replayed here. "unavailable" means Cloudflare couldn't be asked; callers turn it away too,
// since the widget in the page depends on Cloudflare anyway.
export async function verifyTurnstile(token: unknown, action: string, remoteIp: string, log: FastifyBaseLogger): Promise<TurnstileResult> {
    const secret = process.env.TURNSTILE_SECRET;
    if (!secret) {
        log.error("TURNSTILE_SECRET is not set");
        return "unavailable";
    }
    if (typeof token !== "string" || !token || token.length > MAX_TOKEN_LENGTH) return "invalid";

    try {
        const res = await fetch(SITEVERIFY_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ secret, response: token, remoteip: remoteIp }),
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`siteverify answered ${res.status}`);
        const result = (await res.json()) as { success: boolean; action?: string; "error-codes"?: string[] };

        if (result.success && result.action === action) return "ok";
        log.info({ errorCodes: result["error-codes"], action: result.action }, "turnstile rejected");
        return "invalid";
    } catch (err) {
        log.error({ err }, "turnstile siteverify failed");
        return "unavailable";
    }
}
