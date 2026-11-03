import crypto from 'node:crypto';
import { hashToken } from '@/utils/crypto.js';

// How long a code works once sent.
export const OTP_TTL_MS = 10 * 60 * 1000;
// A resend before this replaces nothing: it keeps one inbox from being flooded and one code alive long enough to type.
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
// Wrong guesses a code survives. Six digits is a million options, so it can't take many.
export const OTP_MAX_ATTEMPTS = 5;

export function genOtp() {
    return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

// Constant-time, so how much of a guess matched can't be timed. Both sides are hex SHA-256, so equal length.
export function otpMatches(code: string, codeHash: string) {
    const guess = Buffer.from(hashToken(code), 'hex');
    const stored = Buffer.from(codeHash, 'hex');
    return guess.length === stored.length && crypto.timingSafeEqual(guess, stored);
}
