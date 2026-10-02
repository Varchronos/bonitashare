import type { APIRoute } from 'astro';
import type { ApiResponse } from '@bonitashare/shared-types';
import type { FileLink } from '../../../lib/file';

// Browser-reachable lookup for an uploaded file's thumbnail, so the upload list can swap its icon
// once the worker has made one. Backed by GET /download/:id, which applies the same visibility
// rules as the share page; only the thumbnail URL is passed on.
export const GET: APIRoute = async ({ request, params }) => {
	const res = await fetch(`${process.env.API_INTERNAL_URL}/download/${params.id}`, {
		headers: { cookie: request.headers.get('cookie') ?? '' },
	});

	const json = (await res.json()) as ApiResponse<FileLink>;
	const body: ApiResponse<{ thumbnailUrl: string | null }> =
		json.data === null ? json : { data: { thumbnailUrl: json.data.thumbnailUrl }, error: null };

	return new Response(JSON.stringify(body), {
		status: res.status,
		headers: { 'content-type': 'application/json' },
	});
};
