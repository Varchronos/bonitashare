import type { APIRoute } from 'astro';

// Browser-reachable proxy to the API's GET /files/incomplete: the upload page asks for the user's
// unfinished uploads once it has loaded, so the storage reads behind them never delay the page.
export const GET: APIRoute = async ({ request }) => {
	const res = await fetch(`${process.env.API_INTERNAL_URL}/api/v1/files/incomplete`, {
		headers: { cookie: request.headers.get('cookie') ?? '' },
	});

	return new Response(res.body, {
		status: res.status,
		headers: { 'content-type': 'application/json' },
	});
};
