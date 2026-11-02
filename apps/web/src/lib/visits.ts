import type { ApiResponse, ArtifactKind, Visit } from '@bonitashare/shared-types';

// Signed-in users' "Shared with you", kept on the server. Anonymous users have the same list in
// IndexedDB instead (lib/recent-visits.ts).

// Server-to-server during render, like lib/files.ts, so the list is in the first HTML. Null if the
// API couldn't answer.
export async function getVisits(cookie: string): Promise<Visit[] | null> {
	try {
		const res = await fetch(`${process.env.API_INTERNAL_URL}/api/v1/visits`, {
			headers: { cookie },
		});
		const { data } = (await res.json()) as ApiResponse<Visit[]>;
		return data;
	} catch {
		return null;
	}
}

// Browser side, through the pages/api/v1/visits proxies. Callers don't wait on these: the list is
// a convenience, and a failed write only means it's a little out of date.
export async function recordRemoteVisit(kind: ArtifactKind, id: string) {
	await fetch('/api/v1/visits', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ kind, id }),
	});
}

export async function removeRemoteVisit(kind: ArtifactKind, id: string) {
	await fetch(`/api/v1/visits/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function clearRemoteVisits() {
	await fetch('/api/v1/visits', { method: 'DELETE' });
}
