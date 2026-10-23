import type { ApiResponse, DeletedFile, FilePage } from '@bonitashare/shared-types';

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

// Browser side, through the pages/api/v1/files proxies. Throw with the server's message on failure.
async function send(path: string, method: string, fallbackError: string): Promise<void> {
	const res = await fetch(path, { method });
	if (res.ok) return;
	const body = (await res.json().catch(() => null)) as ApiResponse<null> | null;
	throw new Error(body?.error?.message ?? fallbackError);
}

export const deleteFile = (id: string) =>
	send(`/api/v1/files/${encodeURIComponent(id)}`, 'DELETE', "Couldn't delete the file.");

export const restoreFile = (id: string) =>
	send(`/api/v1/files/${encodeURIComponent(id)}/restore`, 'POST', "Couldn't restore the file.");

// Server-to-server during render, for the recently deleted page. Null if the API couldn't answer.
export async function getDeletedFiles(cookie: string): Promise<DeletedFile[] | null> {
	try {
		const res = await fetch(`${process.env.API_INTERNAL_URL}/api/v1/files/deleted`, {
			headers: { cookie },
		});
		const { data } = (await res.json()) as ApiResponse<DeletedFile[]>;
		return data;
	} catch {
		return null;
	}
}
