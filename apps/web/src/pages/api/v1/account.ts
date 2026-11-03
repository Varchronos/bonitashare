import type { APIRoute } from 'astro';

// Browser-reachable proxy to the API's DELETE /account (beta), for the account page's delete button.
// Passes the password through, and the cookies the API clears or restores on the way out.
export const DELETE: APIRoute = async ({ request }) => {
	const res = await fetch(`${process.env.API_INTERNAL_URL}/api/v1/account`, {
		method: 'DELETE',
		headers: {
			cookie: request.headers.get('cookie') ?? '',
			'content-type': 'application/json',
		},
		body: await request.text(),
	});

	const headers = new Headers({ 'content-type': 'application/json' });
	for (const cookie of res.headers.getSetCookie()) headers.append('set-cookie', cookie);
	const retryAfter = res.headers.get('retry-after');
	if (retryAfter) headers.set('retry-after', retryAfter);

	return new Response(res.body, { status: res.status, headers });
};
