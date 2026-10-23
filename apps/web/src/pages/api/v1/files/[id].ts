import type { APIRoute } from 'astro';

// Browser-reachable proxy to the API's DELETE /files/:id, for the delete buttons on the upload page.
export const DELETE: APIRoute = async ({ request, params }) => {
	const res = await fetch(`${process.env.API_INTERNAL_URL}/api/v1/files/${encodeURIComponent(params.id!)}`, {
		method: 'DELETE',
		headers: { cookie: request.headers.get('cookie') ?? '' },
	});

	return new Response(res.body, {
		status: res.status,
		headers: { 'content-type': 'application/json' },
	});
};
