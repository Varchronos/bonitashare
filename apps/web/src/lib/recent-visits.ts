import { createStore, del, entries, set, delMany, clear } from 'idb-keyval';

// Other people's files this browser has opened, newest first, for the homepage's "Recently viewed".
// Only in the browser: it's a convenience, not account data, so nothing goes to the server.
export type RecentVisit = {
	id: string;
	filename: string;
	contentType: string | null;
	sizeBytes: number;
	// The thumbnail bucket is public and its URLs don't expire, so it's safe to keep.
	thumbnailUrl: string | null;
	visitedAt: number;
};

const MAX_VISITS = 24;

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
