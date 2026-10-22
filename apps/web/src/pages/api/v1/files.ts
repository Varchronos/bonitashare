import type { APIRoute } from 'astro';

// Browser-reachable proxy to the API's GET /files, so the upload page can load further pages of the
// user's files (the first comes with the page — see lib/files.ts).
export const GET: APIRoute = async ({ request, url }) => {
	const res = await fetch(`${process.env.API_INTERNAL_URL}/api/v1/files${url.search}`, {
		headers: { cookie: request.headers.get('cookie') ?? '' },
	});

	return new Response(res.body, {
		status: res.status,
		headers: { 'content-type': 'application/json' },
	});
};
