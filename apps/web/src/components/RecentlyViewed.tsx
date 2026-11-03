import { useEffect, useState } from 'react';
import { formatBytes, type Visit } from '@bonitashare/shared-types';
import { clearVisits, listVisits, removeVisit, type RecentVisit } from '../lib/recent-visits';
import { clearRemoteVisits, removeRemoteVisit } from '../lib/visits';
import FileThumb from './upload/FileThumb';
import { TrashIcon } from './upload/icons';

// Files other people shared that this user has opened. Signed in, the page hands over the server's
// list (`remote`, null if it couldn't load); anonymous, it's read from IndexedDB once hydrated. Renders
// nothing until there's something to show. Removing and clearing don't wait for the write.
export default function RecentlyViewed({ limit = 8, signedIn, remote }: { limit?: number; signedIn: boolean; remote?: Visit[] | null }) {
	const [visits, setVisits] = useState<(RecentVisit | Visit)[]>(() => (signedIn ? (remote ?? []) : []));

	useEffect(() => {
		if (signedIn) return;
		listVisits()
			.then(setVisits)
			// Private windows and blocked storage: just no list.
			.catch(() => {});
	}, []);

	if (visits.length === 0) return null;

	function remove(id: string) {
		setVisits((prev) => prev.filter((v) => v.id !== id));
		(signedIn ? removeRemoteVisit('file', id) : removeVisit(id)).catch(() => {});
	}

	function clearAll() {
		setVisits([]);
		(signedIn ? clearRemoteVisits() : clearVisits()).catch(() => {});
	}

	return (
		<section className="mt-8 flex flex-col gap-3">
			<div className="flex items-center justify-between gap-3">
				<h2 className="text-title">Shared with you</h2>
				<button type="button" className="btn btn-text btn-sm" onClick={clearAll}>
					Clear
				</button>
			</div>
			<ul className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4">
				{visits.slice(0, limit).map((v) => (
					<li key={v.id} className="card relative flex min-w-0 flex-col p-2 transition-colors hover:bg-surface-container-high">
						<a href={`/f/${encodeURIComponent(v.id)}`} className="flex min-w-0 flex-col">
							<FileThumb url={v.thumbnailUrl} isVideo={v.contentType?.startsWith('video/') ?? false} />
							<div className="flex min-w-0 flex-col gap-1 px-2 pt-3 pb-1">
								<span className="truncate pr-6 text-sm font-medium text-on-surface">{v.filename}</span>
								<span className="truncate text-xs text-on-surface-variant">
									{formatBytes(v.sizeBytes)} · Viewed {new Date(v.visitedAt).toLocaleDateString()}
								</span>
							</div>
						</a>
						<button
							type="button"
							className="icon-btn icon-btn-sm absolute right-2 bottom-2 hover:text-error"
							aria-label={`Remove ${v.filename} from recently viewed`}
							onClick={() => remove(v.id)}
						>
							<TrashIcon />
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}
