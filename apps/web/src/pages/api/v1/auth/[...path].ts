import type { APIRoute } from 'astro';

// Browser-reachable proxy to the API's /auth routes. Only the ones the pages use pass, so this can't
// be pointed at anything else the API serves. Set-Cookie comes back through: verify rotates the session.
const ALLOWED = new Set(['signup', 'signup/resend', 'signup/verify', 'login']);

export const POST: APIRoute = async ({ request, params }) => {
	if (!params.path || !ALLOWED.has(params.path)) return new Response(null, { status: 404 });

	const res = await fetch(`${process.env.API_INTERNAL_URL}/api/v1/auth/${params.path}`, {
		method: 'POST',
		headers: {
			cookie: request.headers.get('cookie') ?? '',
			'content-type': 'application/json',
			'user-agent': request.headers.get('user-agent') ?? '',
		},
		body: await request.text(),
	});

	const headers = new Headers({ 'content-type': 'application/json' });
	const retryAfter = res.headers.get('retry-after');
	if (retryAfter) headers.set('retry-after', retryAfter);
	for (const cookie of res.headers.getSetCookie()) headers.append('set-cookie', cookie);

	return new Response(res.body, { status: res.status, headers });
};
