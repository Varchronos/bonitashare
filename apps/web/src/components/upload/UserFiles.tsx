import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { formatBytes, type FilePage, type UserFile } from '@bonitashare/shared-types';
import { useUploadStore } from '../../store/file-store';
import { shareIdFor } from '../../lib/upload-task';
import { fetchFiles } from '../../lib/files';
import { copyLink } from './TaskRow';
import { TrashIcon } from './icons';
import FileThumb from './FileThumb';
import ShareLinks from './ShareLinks';
import { useDeleteFile } from './useDeleteFile';

// The user's finished uploads, from the server a page at a time. Uploads still in the local store
// (in progress, or finished during this visit) are left out here: TaskList already shows them.
// With `limit`, only the newest few, and a link to the upload page in place of "Load more".
export default function UserFiles({ initial, limit }: { initial: FilePage | null; limit?: number }) {
	const [files, setFiles] = useState<UserFile[]>(initial?.files ?? []);
	const [cursor, setCursor] = useState(initial?.nextCursor ?? null);
	const [loading, setLoading] = useState(false);
	const [failed, setFailed] = useState(false);
	const localIds = useUploadStore(useShallow((s) => s.files.map(shareIdFor)));
	// This also renders on the server, which has no window; links are relative until hydrated.
	const [origin, setOrigin] = useState('');

	async function load(from: string | null) {
		setLoading(true);
		setFailed(false);
		try {
			const page = await fetchFiles(from);
			// Keyed by id: an upload finishing between two fetches shifts the pages, and the same file
			// could otherwise come back twice.
			setFiles((prev) => {
				const seen = new Set(prev.map((f) => f.id));
				return [...prev, ...page.files.filter((f) => !seen.has(f.id))];
			});
			setCursor(page.nextCursor);
		} catch {
			setFailed(true);
		} finally {
			setLoading(false);
		}
	}

	// The page couldn't fetch the first page while rendering; try again from here.
	useEffect(() => {
		setOrigin(window.location.origin);
		if (!initial) load(null);
	}, []);

	const visible = files.filter((f) => !localIds.includes(f.id)).slice(0, limit);
	if (visible.length === 0 && (!cursor || limit) && !failed) return null;

	return (
		<section className="mt-8 flex flex-col gap-3">
			<h2 className="text-title">{limit ? 'Recent uploads' : 'Your files'}</h2>
			<ul className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4">
				{visible.map((file) => (
					<FileRow
						key={file.id}
						file={file}
						origin={origin}
						onDeleted={() => setFiles((prev) => prev.filter((f) => f.id !== file.id))}
					/>
				))}
			</ul>
			{failed && <span className="text-sm text-error">Couldn't load your files.</span>}
			{(failed || (cursor && !limit)) && (
				<button type="button" className="btn btn-outlined self-start" disabled={loading} onClick={() => load(cursor)}>
					{loading ? 'Loading…' : failed ? 'Try again' : 'Load more'}
				</button>
			)}
			{limit && !failed && (
				<a href="/upload" className="btn btn-tonal self-start">
					View all uploads →
				</a>
			)}
		</section>
	);
}

function FileRow({ file, origin, onDeleted }: { file: UserFile; origin: string; onDeleted: () => void }) {
	const { remove, deleting, error } = useDeleteFile(file.id, file.filename, onDeleted);
	const isVideo = file.contentType?.startsWith('video/') ?? false;
	const link = `${origin}/f/${file.id}`;

	return (
		<li className="card flex min-w-0 flex-col p-2 transition-colors hover:bg-surface-container-high">
			<FileThumb url={file.thumbnailUrl} isVideo={isVideo} />
			<div className="flex min-w-0 flex-1 flex-col gap-2 px-2 pt-3 pb-1">
				<div className="flex items-center justify-between gap-3">
					<span className="min-w-0 flex-1 truncate text-sm font-medium text-on-surface">{file.filename}</span>
					<div className="-mr-1 flex shrink-0 items-center">
						<button type="button" className="icon-btn icon-btn-sm hover:text-error" aria-label="Delete" disabled={deleting} onClick={remove}>
							<TrashIcon />
						</button>
					</div>
				</div>
				<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
					{error ? (
						<span className="min-w-0 truncate text-xs text-error">{error}</span>
					) : (
						<span className="min-w-0 truncate text-xs text-on-surface-variant">{formatBytes(file.sizeBytes)}</span>
					)}
					{file.expiresAt && (
						<span className="shrink-0 text-xs text-on-surface-variant">Expires {new Date(file.expiresAt).toLocaleDateString()}</span>
					)}
				</div>
				<a href={link} target="_blank" rel="noreferrer" className="truncate text-xs text-primary hover:underline">
					{link}
				</a>
				<div className="flex flex-wrap items-center gap-1">
					<button type="button" className="btn btn-tonal btn-sm" onClick={() => copyLink(link)}>
						Copy
					</button>
					<ShareLinks link={link} />
				</div>
			</div>
		</li>
	);
}
