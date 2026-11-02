import type { AstroGlobal } from 'astro';
import type { Account, ApiResponse } from '@bonitashare/shared-types';

// Server-to-server during render, like lib/usage.ts. Takes the cookie getSession returns.
// Null if the API couldn't answer.
export async function getAccount(cookie: string): Promise<Account | null> {
	try {
		const res = await fetch(`${process.env.API_INTERNAL_URL}/api/v1/account`, {
			headers: { cookie },
		});
		const { data } = (await res.json()) as ApiResponse<Account>;
		return data;
	} catch {
		return null;
	}
}

// The account behind this render, looked up once and shared by the page and the navbar. Uses the cookie
// getSession resolved when the page called it; otherwise the request's own, and only if it has a
// session, so crawlers hitting public pages don't cost an API call. Null for no session or no answer.
export async function currentAccount(Astro: AstroGlobal): Promise<Account | null> {
	if (Astro.locals.account !== undefined) return Astro.locals.account;

	const cookie = Astro.locals.sessionCookie ?? (Astro.cookies.has('session') ? Astro.request.headers.get('cookie') : null);
	Astro.locals.account = cookie ? await getAccount(cookie) : null;
	return Astro.locals.account;
}
