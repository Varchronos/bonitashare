import { eq } from 'drizzle-orm';
import { users } from '@bonitashare/core/db';
import { tierOf, type Tier } from '@bonitashare/shared-types';
import { db } from '@/db/client.js';

export async function resolveTier(userId: string | null): Promise<Tier> {
    if (!userId) return 'anonymous';
    const [user] = await db
        .select({ email: users.email, plan: users.plan, planExpiresAt: users.planExpiresAt })
        .from(users)
        .where(eq(users.id, userId));
    return user ? tierOf(user) : 'anonymous';
}
