// Generic tus-protocol reverse proxy: browser <-> Astro <-> internal API.
// The internal API isn't reachable from the browser directly (see
// pages/api/upload.ts's original comment), so every tus method (POST,
// HEAD, PATCH, DELETE, OPTIONS) needs to pass through here, headers and
// body intact in both directions.

const STRIP_REQUEST_HEADERS = new Set(['host', 'connection', 'content-length', 'transfer-encoding']);

export async function proxyTus(request: Request, targetPath: string): Promise<Response> {
	const headers = new Headers();
	for (const [key, value] of request.headers) {
		if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
	}

	const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

	const res = await fetch(`${process.env.API_INTERNAL_URL}${targetPath}`, {
		method: request.method,
		headers,
		body: hasBody ? request.body : undefined,
		...(hasBody ? { duplex: 'half' } : {}),
	} as RequestInit);

	const responseHeaders = new Headers();
	for (const [key, value] of res.headers) {
		if (key.toLowerCase() === 'set-cookie') continue;
		responseHeaders.set(key, value);
	}
	for (const cookie of res.headers.getSetCookie()) responseHeaders.append('set-cookie', cookie);

	// The internal API doesn't know it's mounted behind /api/upload here, so
	// its Location always points at its own /upload/<id> — rewrite it to
	// the path the browser actually needs to PATCH/HEAD/DELETE against.
	const location = res.headers.get('location');
	if (location) {
		const id = location.split('/').filter(Boolean).pop();
		responseHeaders.set('location', `/api/upload/${id}`);
	}

	return new Response(res.body, { status: res.status, headers: responseHeaders });
}
