import type { APIRoute } from 'astro';

// Browser-reachable proxy to the API's GET /usage, so the upload page can refetch the quota meter
// after an upload finishes, fails, or is cancelled.
export const GET: APIRoute = async ({ request }) => {
	const res = await fetch(`${process.env.API_INTERNAL_URL}/api/v1/usage`, {
		headers: { cookie: request.headers.get('cookie') ?? '' },
	});

	return new Response(res.body, {
		status: res.status,
		headers: { 'content-type': 'application/json' },
	});
};
