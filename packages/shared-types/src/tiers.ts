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
