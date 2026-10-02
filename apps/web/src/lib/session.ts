import type { AstroGlobal } from 'astro';
import type { ApiResponse } from '@bonitashare/shared-types';

const SESSION_COOKIE = 'session';

// Server-to-server call during render, so the session is already resolved
// by the time the page's HTML reaches the browser — no client-side fetch,
// no CORS (this never touches the browser), no flash of unauthenticated UI.
// Uses process.env (not import.meta.env) so it reads the container's
// runtime env, not whatever was set at `astro build` time.
//
// Also renews an expired session (same user). Returns the cookie header to
// use for any further API calls in this render — the incoming request still
// carries the old token, so forwarding that would hit the expired session.
export async function getSession(Astro: AstroGlobal) {
	let cookie = Astro.request.headers.get('cookie') ?? '';

	const res = await fetch(`${process.env.API_INTERNAL_URL}/session`, {
		headers: { cookie },
	});

	// The API may have just minted or renewed the session — forward its
	// Set-Cookie(s) onto our own response so the browser actually stores it.
	for (const setCookie of res.headers.getSetCookie()) {
		Astro.response.headers.append('set-cookie', setCookie);

		const pair = setCookie.split(';')[0];
		if (pair.startsWith(`${SESSION_COOKIE}=`)) {
			cookie = [...cookie.split(/;\s*/).filter((c) => c && !c.startsWith(`${SESSION_COOKIE}=`)), pair].join('; ');
		}
	}

	const { data } = (await res.json()) as ApiResponse<{ userId: string }>;
	return { userId: data?.userId ?? null, cookie };
}

// Renews only for visitors who already have a session. For pages anyone
// (including crawlers/link unfurlers) can hit, where minting a brand-new
// anonymous user per visit would be wrong.
export async function refreshSession(Astro: AstroGlobal) {
	if (!Astro.cookies.has(SESSION_COOKIE)) {
		return { userId: null, cookie: Astro.request.headers.get('cookie') ?? '' };
	}
	return getSession(Astro);
}
