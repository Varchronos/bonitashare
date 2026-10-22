import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { formatBytes, type FilePage, type UserFile } from '@bonitashare/shared-types';
import { useUploadStore } from '../../store/file-store';
import { shareIdFor } from '../../lib/upload-task';
import { fetchFiles } from '../../lib/files';
import { copyLink } from './TaskRow';
import { FileIcon } from './icons';

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
		<section className="user-files">
			<h2>Your files</h2>
			<ul className="file-list">
				{visible.map((file) => (
					<FileRow key={file.id} file={file} origin={origin} />
				))}
			</ul>
			{failed && <span className="status-text status-text-error">Couldn't load your files.</span>}
			{(cursor || failed) && (
				<button type="button" className="tasks-show-more" disabled={loading} onClick={() => load(cursor)}>
					{loading ? 'Loading…' : failed ? 'Try again' : 'Load more'}
				</button>
			)}
		</section>
	);
}

function FileRow({ file, origin }: { file: UserFile; origin: string }) {
	const [thumbnailFailed, setThumbnailFailed] = useState(false);
	const isVideo = file.contentType?.startsWith('video/') ?? false;
	const link = `${origin}/f/${file.id}`;

	return (
		<li>
			<div className={`task-icon${isVideo ? ' task-icon-video' : ''}`}>
				{file.thumbnailUrl && !thumbnailFailed ? (
					<img
						className={isVideo ? 'task-thumb task-thumb-video' : 'task-thumb'}
						src={file.thumbnailUrl}
						alt=""
						onError={() => setThumbnailFailed(true)}
					/>
				) : (
					<FileIcon />
				)}
			</div>
			<div className="task-wrapper">
				<div className="task-info">
					<span className="file-name">{file.filename}</span>
				</div>
				<div className="task-status-row">
					<span className="status-text">{formatBytes(file.sizeBytes)}</span>
					{file.expiresAt && (
						<span className="status-pct">Expires {new Date(file.expiresAt).toLocaleDateString()}</span>
					)}
				</div>
				<div className="link-row">
					<a href={link} target="_blank" rel="noreferrer" className="link-url">
						{link}
					</a>
					<button type="button" className="copy" onClick={() => copyLink(link)}>
						Copy
					</button>
				</div>
			</div>
		</li>
	);
}
