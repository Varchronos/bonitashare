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

export type FileVideo = {
	status: 'pending' | 'done' | 'failed';
	// Master playlist; null until the transcode is done.
	hlsUrl: string | null;
	durationMs: number | null;
	width: number | null;
	height: number | null;
};

// Server-to-server calls during render — see lib/session.ts for why (no
// CORS, no client-side round trip before the page can render).
// Renews an expired session first, so an owner viewing their own private
// file isn't told it doesn't exist just because their session lapsed.
// Returns the cookie to reuse for further calls in this render: renewing
// again would mint a second session.
export async function getFileLink(Astro: AstroGlobal, id: string) {
	const { cookie } = await refreshSession(Astro);

	const res = await fetch(`${process.env.API_INTERNAL_URL}/download/${id}`, {
		headers: { cookie },
	});

	return { ...((await res.json()) as ApiResponse<FileLink>), cookie };
}

// The HLS stream for a video file. Only worth calling once getFileLink has
// said the file is a video; anything else is a VIDEO_NOT_FOUND.
export async function getFileVideo(cookie: string, id: string): Promise<ApiResponse<FileVideo>> {
	const res = await fetch(`${process.env.API_INTERNAL_URL}/download/${id}/video`, {
		headers: { cookie },
	});

	return (await res.json()) as ApiResponse<FileVideo>;
}
