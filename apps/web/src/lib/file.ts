import type { AstroGlobal } from 'astro';
import type { ApiResponse } from '@bonitashare/shared-types';
import { refreshSession } from './session';

export type FileLink = {
	url: string;
	thumbnailUrl: string | null;
	filename: string;
	contentType: string | null;
	sizeBytes: number;
};

// Server-to-server call during render — see lib/session.ts for why (no
// CORS, no client-side round trip before the page can render).
// Renews an expired session first, so an owner viewing their own private
// file isn't told it doesn't exist just because their session lapsed.
export async function getFileLink(Astro: AstroGlobal, id: string): Promise<ApiResponse<FileLink>> {
	const { cookie } = await refreshSession(Astro);

	const res = await fetch(`${process.env.API_INTERNAL_URL}/download/${id}`, {
		headers: { cookie },
	});

	return (await res.json()) as ApiResponse<FileLink>;
}
