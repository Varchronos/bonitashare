import type { ApiResponse, FilePage } from '@bonitashare/shared-types';

// Server-to-server during render, like lib/usage.ts, so the first page of the user's files is in the
// first HTML. Null if the API couldn't answer — the list then loads from the browser instead.
export async function getFiles(cookie: string): Promise<FilePage | null> {
	try {
		const res = await fetch(`${process.env.API_INTERNAL_URL}/api/v1/files`, {
			headers: { cookie },
		});
		const { data } = (await res.json()) as ApiResponse<FilePage>;
		return data;
	} catch {
		return null;
	}
}

// Browser side: the next page, through the pages/api/v1/files proxy.
export async function fetchFiles(cursor: string | null): Promise<FilePage> {
	const res = await fetch(cursor ? `/api/v1/files?cursor=${encodeURIComponent(cursor)}` : '/api/v1/files');
	const { data, error } = (await res.json()) as ApiResponse<FilePage>;
	if (!data) throw new Error(error.message);
	return data;
}
