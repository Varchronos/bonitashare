// Generic tus-protocol reverse proxy: browser <-> Astro <-> internal API.
// The internal API isn't reachable from the browser directly (see
// pages/api/v1/upload.ts's original comment), so every tus method (POST,
// HEAD, PATCH, DELETE, OPTIONS) needs to pass through here, headers and
// body intact in both directions.
//
// In prod the Cloudflare Tunnel sends /api/v1/upload* straight to the API, so this only carries uploads
// in dev (and if that tunnel rule is missing). It holds each request body in memory while forwarding
// it — fine for one dev user, but not something to route production uploads through.

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

	return new Response(res.body, { status: res.status, headers: responseHeaders });
}
