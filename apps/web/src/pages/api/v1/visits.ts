import type { APIRoute } from 'astro';

// Browser-reachable proxies to the API's /visits, for signed-in users' "Shared with you": the share
// page records a visit (POST), the homepage list's Clear button empties it (DELETE). The list itself
// comes with the homepage — see lib/visits.ts.
async function forward(request: Request, method: string, body?: string) {
	const res = await fetch(`${process.env.API_INTERNAL_URL}/api/v1/visits`, {
		method,
		headers: {
			cookie: request.headers.get('cookie') ?? '',
			...(body !== undefined && { 'content-type': 'application/json' }),
		},
		body,
	});

	return new Response(res.body, {
		status: res.status,
		headers: { 'content-type': 'application/json' },
	});
}

export const POST: APIRoute = async ({ request }) => forward(request, 'POST', await request.text());
export const DELETE: APIRoute = async ({ request }) => forward(request, 'DELETE');
