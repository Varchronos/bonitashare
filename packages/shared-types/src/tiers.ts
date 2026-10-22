import { formatBytes } from './utils/byte-conversion.js'

const MB = 1024 ** 2
const GB = 1024 ** 3
const DAY = 24 * 60 * 60

export type Tier = 'anonymous' | 'free' | 'pro'
export type TierEntitlements = {
    weeklyUploadBytes: number;
    maxFileBytes: number;
    storageBytes: number | null;
    maxExpirySeconds: number | null;
    customExpiry: boolean;
    videoRenditions: number[];
}

export const TIER_LIMITS = {
    anonymous: {
        weeklyUploadBytes: 5 * GB,
        maxFileBytes: 2 * GB,
        storageBytes: null,          // bounded by the fixed expiry
        maxExpirySeconds: 30 * DAY,  // fixed, not user-selectable
        customExpiry: false,
        videoRenditions: [],
    },
    free: {
        weeklyUploadBytes: 20 * GB,
        maxFileBytes: 5 * GB,
        storageBytes: 25 * GB,
        maxExpirySeconds: 90 * DAY,
        customExpiry: true,
        videoRenditions: [720],
    },
    pro: {
        weeklyUploadBytes: 150 * GB,
        maxFileBytes: 25 * GB,
        storageBytes: 250 * GB,
        maxExpirySeconds: null,      // never
        customExpiry: true,
        videoRenditions: [480, 720, 1080],
    },
} as const satisfies Record<Tier, TierEntitlements>

// Anonymous isn't stored anywhere: it's a user without an email. Pro only counts until planExpiresAt.
export function tierOf(user: { email: string | null; plan: 'free' | 'pro'; planExpiresAt: Date | null }): Tier {
    if (!user.email) return 'anonymous'
    if (user.plan === 'pro' && user.planExpiresAt && user.planExpiresAt > new Date()) return 'pro'
    return 'free'
}

// GET /usage. Weekly counts every upload started in the last 7 days at its full size (a cancelled one
// at what it reached); storage counts files that still exist. Storage has no limit for anonymous.
export type Usage = {
    tier: Tier;
    weekly: { used: number; limit: number; nextFreesAt: string | null };
    storage: { used: number; limit: number | null };
}

const PLAN_NAMES: Record<Tier, string> = { anonymous: 'Guest', free: 'Free', pro: 'Pro' }

// Why an upload was refused. Shared so the server's 403/413 and the upload page's own check before
// sending say the same thing, with the numbers that matter for each.
export const quotaMessages = {
    fileTooLarge: (tier: Tier) =>
        `File is larger than your ${PLAN_NAMES[tier]} plan allows (${formatBytes(TIER_LIMITS[tier].maxFileBytes)} per file)`,
    weeklyFull: (left: number, limit: number) =>
        `Not enough weekly upload quota left (${formatBytes(Math.max(0, left))} of ${formatBytes(limit)} left)`,
    storageFull: (left: number, limit: number) =>
        `Storage is almost full (${formatBytes(Math.max(0, left))} of ${formatBytes(limit)} left)`,
}
