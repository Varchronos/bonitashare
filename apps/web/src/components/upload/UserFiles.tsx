import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { formatBytes, type FilePage, type UserFile } from '@bonitashare/shared-types';
import { useUploadStore } from '../../store/file-store';
import { shareIdFor } from '../../lib/upload-task';
import { fetchFiles } from '../../lib/files';
import { copyLink } from './TaskRow';
import { TrashIcon } from './icons';
import FileThumb from './FileThumb';
import * as ui from './ui';
import { useDeleteFile } from './useDeleteFile';

// The user's finished uploads, from the server a page at a time. Uploads still in the local store
// (in progress, or finished during this visit) are left out here: TaskList already shows them.
export default function UserFiles({ initial }: { initial: FilePage | null }) {
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

	const visible = files.filter((f) => !localIds.includes(f.id));
	if (visible.length === 0 && !cursor && !failed) return null;

	return (
		<section className="mt-8 flex flex-col gap-3">
			<h2 className="text-lg font-bold">Your files</h2>
			<ul className="flex flex-col gap-2">
				{visible.map((file) => (
					<FileRow
						key={file.id}
						file={file}
						origin={origin}
						onDeleted={() => setFiles((prev) => prev.filter((f) => f.id !== file.id))}
					/>
				))}
			</ul>
			{failed && <span className={ui.statusText('error')}>Couldn't load your files.</span>}
			{(cursor || failed) && (
				<button type="button" className={ui.moreButton} disabled={loading} onClick={() => load(cursor)}>
					{loading ? 'Loading…' : failed ? 'Try again' : 'Load more'}
				</button>
			)}
		</section>
	);
}

function FileRow({ file, origin, onDeleted }: { file: UserFile; origin: string; onDeleted: () => void }) {
	const { remove, deleting, error } = useDeleteFile(file.id, file.filename, onDeleted);
	const isVideo = file.contentType?.startsWith('video/') ?? false;
	const link = `${origin}/f/${file.id}`;

	return (
		<li className={ui.row}>
			<FileThumb url={file.thumbnailUrl} isVideo={isVideo} />
			<div className={ui.rowBody}>
				<div className={ui.rowLine}>
					<span className={ui.fileName}>{file.filename}</span>
					<div className={ui.rowActions}>
						<button type="button" className={ui.iconButton} aria-label="Delete" disabled={deleting} onClick={remove}>
							<TrashIcon />
						</button>
					</div>
				</div>
				<div className={ui.rowLine}>
					{error ? (
						<span className={ui.statusText('error')}>{error}</span>
					) : (
						<span className={ui.statusText()}>{formatBytes(file.sizeBytes)}</span>
					)}
					{file.expiresAt && (
						<span className={ui.statusAside}>Expires {new Date(file.expiresAt).toLocaleDateString()}</span>
					)}
				</div>
				<div className={ui.linkRow}>
					<a href={link} target="_blank" rel="noreferrer" className={ui.linkUrl}>
						{link}
					</a>
					<button type="button" className={ui.smallButton} onClick={() => copyLink(link)}>
						Copy
					</button>
				</div>
			</div>
		</li>
	);
}
