import type { APIRoute } from 'astro';

// Browser-reachable proxy to the API's GET /session, so client code can
// renew an expired session mid-flight (see upload-task's 401 handling).
export const GET: APIRoute = async ({ request }) => {
	const res = await fetch(`${process.env.API_INTERNAL_URL}/session`, {
		headers: { cookie: request.headers.get('cookie') ?? '' },
	});

	const headers = new Headers({ 'content-type': 'application/json' });
	for (const cookie of res.headers.getSetCookie()) headers.append('set-cookie', cookie);

	return new Response(res.body, { status: res.status, headers });
};
