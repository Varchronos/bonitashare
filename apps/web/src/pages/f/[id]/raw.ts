import type { APIRoute } from 'astro';
import type { ApiResponse } from '@bonitashare/shared-types';
import type { FileLink } from '../../../lib/file';

// A link to the file itself that doesn't expire, for og:video: redirects to a presigned URL signed
// for this request. Same visibility rules as the share page (GET /download/:id). Link-preview
// crawlers send no cookie, so to them only public files resolve.
export const GET: APIRoute = async ({ request, params }) => {
	const res = await fetch(`${process.env.API_INTERNAL_URL}/api/v1/download/${encodeURIComponent(params.id!)}`, {
		headers: { cookie: request.headers.get('cookie') ?? '' },
	});
	const { data } = (await res.json()) as ApiResponse<FileLink>;

	if (!data) return new Response(null, { status: res.status });

	return new Response(null, {
		status: 302,
		// Well inside the presigned URL's hour, so a cached redirect never points at an expired one.
		headers: { location: data.url, 'cache-control': 'private, max-age=300' },
	});
};
