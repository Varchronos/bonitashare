import type { APIRoute } from 'astro';

// Browser-reachable proxy to the API's POST /admin/files/:id/reinstate, for the admin reports table's
// Reinstate button. The API checks the admin role itself.
export const POST: APIRoute = async ({ request, params }) => {
	const res = await fetch(`${process.env.API_INTERNAL_URL}/api/v1/admin/files/${encodeURIComponent(params.id!)}/reinstate`, {
		method: 'POST',
		headers: { cookie: request.headers.get('cookie') ?? '' },
	});

	return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json' } });
};
