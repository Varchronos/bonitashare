import { OTP_TTL_MS } from '@/auth/otp.js';

const MINUTES = OTP_TTL_MS / 60_000;

// Plain on purpose: transactional mail with little markup lands in spam less, and the code is all that matters.
export function signupCodeEmail(to: string, code: string) {
    return {
        to,
        subject: `${code} is your bonitashare code`,
        text: `Your bonitashare verification code is ${code}.\n\nIt expires in ${MINUTES} minutes. If you didn't sign up, you can ignore this email.`,
        html: `<p>Your bonitashare verification code is:</p><p style="font-size:24px;font-weight:600;letter-spacing:4px">${code}</p><p>It expires in ${MINUTES} minutes. If you didn't sign up, you can ignore this email.</p>`,
    };
}
