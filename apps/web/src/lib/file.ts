import type { AstroGlobal } from 'astro';
import type { ApiResponse } from '@bonitashare/shared-types';

export type FileLink = {
	url: string;
	filename: string;
	contentType: string | null;
	sizeBytes: number;
};

// Server-to-server call during render — see lib/session.ts for why (no
// CORS, no client-side round trip before the page can render).
export async function getFileLink(Astro: AstroGlobal, id: string): Promise<ApiResponse<FileLink>> {
	const res = await fetch(`${process.env.API_INTERNAL_URL}/download/${id}`, {
		headers: { cookie: Astro.request.headers.get('cookie') ?? '' },
	});

	for (const cookie of res.headers.getSetCookie()) {
		Astro.response.headers.append('set-cookie', cookie);
	}

	return (await res.json()) as ApiResponse<FileLink>;
}
