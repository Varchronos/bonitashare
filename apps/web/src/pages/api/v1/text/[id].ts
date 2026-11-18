import type { APIRoute } from 'astro';

// Browser-reachable start of a text file, for the share page's code viewer. Backed by
// GET /download/:id/text, which applies the same visibility rules as the share page.
export const GET: APIRoute = async ({ request, params }) => {
	const res = await fetch(`${process.env.API_INTERNAL_URL}/api/v1/download/${encodeURIComponent(params.id!)}/text`, {
		headers: { cookie: request.headers.get('cookie') ?? '' },
	});

	return new Response(res.body, {
		status: res.status,
		headers: { 'content-type': 'application/json' },
	});
};
