import type { APIRoute } from 'astro';

// Browser-reachable proxy to the API's POST /files/:id/restore, for the recently deleted page.
export const POST: APIRoute = async ({ request, params }) => {
	const res = await fetch(`${process.env.API_INTERNAL_URL}/api/v1/files/${encodeURIComponent(params.id!)}/restore`, {
		method: 'POST',
		headers: { cookie: request.headers.get('cookie') ?? '' },
	});

	return new Response(res.body, {
		status: res.status,
		headers: { 'content-type': 'application/json' },
	});
};
