import { createStore, del, entries, set, delMany, clear } from 'idb-keyval';
import { MAX_VISITS } from '@bonitashare/shared-types';

// Other people's files this browser has opened while anonymous, newest first, for the homepage's
// "Shared with you". Anonymous browsing never goes to the server; signup moves this list onto the
// account (see toSignupVisits), and signed-in users' visits are kept there instead (lib/visits.ts).
export type RecentVisit = {
	id: string;
	filename: string;
	contentType: string | null;
	sizeBytes: number;
	// The thumbnail bucket is public and its URLs don't expire, so it's safe to keep.
	thumbnailUrl: string | null;
	visitedAt: number;
};

// Its own database rather than idb-keyval's default: the upload store's clear() wipes that one whole.
// Created lazily, since modules importing this also render on the server, which has no indexedDB.
let store: ReturnType<typeof createStore> | null = null;
const db = () => (store ??= createStore('bonitashare-recent', 'visits'));

// One key per file, so revisiting just moves it to the top and two tabs can't drop each other's writes.
export async function recordVisit(visit: Omit<RecentVisit, 'visitedAt'>) {
	await set(visit.id, { ...visit, visitedAt: Date.now() } satisfies RecentVisit, db());

	const all = await listVisits();
	if (all.length > MAX_VISITS) await delMany(all.slice(MAX_VISITS).map((v) => v.id), db());
}

export async function listVisits(): Promise<RecentVisit[]> {
	const rows = await entries<string, RecentVisit>(db());
	return rows.map(([, v]) => v).sort((a, b) => b.visitedAt - a.visitedAt);
}

export const removeVisit = (id: string) => del(id, db());
export const clearVisits = () => clear(db());

// The list in the shape signup verify takes, to move onto the new account. Empty if IndexedDB can't
// be read: signup shouldn't fail over it.
export async function toSignupVisits() {
	try {
		return (await listVisits()).map((v) => ({ kind: 'file' as const, id: v.id, visitedAt: v.visitedAt }));
	} catch {
		return [];
	}
}
