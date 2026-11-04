import type { APIRoute } from 'astro';

// Browser-reachable proxy to the API's POST /reports, for the report form at /f/<id>/report.
export const POST: APIRoute = async ({ request }) => {
	const res = await fetch(`${process.env.API_INTERNAL_URL}/api/v1/reports`, {
		method: 'POST',
		headers: {
			cookie: request.headers.get('cookie') ?? '',
			'content-type': 'application/json',
		},
		body: await request.text(),
	});

	const headers = new Headers({ 'content-type': 'application/json' });
	const retryAfter = res.headers.get('retry-after');
	if (retryAfter) headers.set('retry-after', retryAfter);

	return new Response(res.body, { status: res.status, headers });
};
