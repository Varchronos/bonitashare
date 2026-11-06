import type { APIRoute } from 'astro';

// Browser-reachable proxy to the API's POST /admin/files/:id/takedown, for the takedown form (the share
// page's admin card and the admin reports table). The API checks the admin role itself.
export const POST: APIRoute = async ({ request, params }) => {
	const res = await fetch(`${process.env.API_INTERNAL_URL}/api/v1/admin/files/${encodeURIComponent(params.id!)}/takedown`, {
		method: 'POST',
		headers: {
			cookie: request.headers.get('cookie') ?? '',
			'content-type': 'application/json',
		},
		body: await request.text(),
	});

	return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json' } });
};
