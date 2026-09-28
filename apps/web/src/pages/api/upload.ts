import type { APIRoute } from 'astro';

// The API is only reachable inside the docker network, so the browser posts
// here and we stream the multipart body straight through to it.
export const POST: APIRoute = async ({ request }) => {
	const res = await fetch(`${process.env.API_INTERNAL_URL}/upload`, {
		method: 'POST',
		headers: {
			'content-type': request.headers.get('content-type') ?? '',
			cookie: request.headers.get('cookie') ?? '',
		},
		body: request.body,
		// Required by Node's fetch when the body is a stream.
		duplex: 'half',
	} as RequestInit);

	const headers = new Headers({ 'content-type': res.headers.get('content-type') ?? 'application/json' });
	for (const cookie of res.headers.getSetCookie()) headers.append('set-cookie', cookie);

	return new Response(res.body, { status: res.status, headers });
};
