import { useEffect, useState } from 'react';
import { useUploadStore, type UploadTask } from '../../store/file-store';
import { pauseUpload, resumeUpload, cancelUpload, shareIdFor, watchThumbnail } from '../../lib/upload-task';
import { FileIcon, TrashIcon, CheckIcon, PauseIcon, PlayIcon, RetryIcon } from './icons';

function formatBytes(bytes: number) {
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB'];
	let value = bytes / 1024;
	let i = 0;
	while (value >= 1024 && i < units.length - 1) {
		value /= 1024;
		i++;
	}
	return `${value.toFixed(1)} ${units[i]}`;
}

function linkFor(task: UploadTask) {
	const id = shareIdFor(task);
	return id ? `${window.location.origin}/${id}` : null;
}

async function copyLink(url: string) {
	try {
		await navigator.clipboard.writeText(url);
	} catch {
		// Clipboard access can be denied (permissions, insecure context) —
		// the link is still shown and selectable, so this is non-fatal.
	}
}

export default function TaskRow({ id }: { id: string }) {
	// Selecting a single task by id, not the whole `files` array: `updateFile`
	// only replaces the matching element, so unrelated rows keep the same
	// reference and never re-render when this one's progress changes.
	const task = useUploadStore((s) => s.files.find((f) => f.id === id));

	// Only images get thumbnails, so other types never poll.
	const awaitingThumbnail = task?.status === 'done' && !task.thumbnailUrl && task.contentType.startsWith('image/');
	useEffect(() => {
		if (!awaitingThumbnail) return;
		const controller = new AbortController();
		watchThumbnail(id, controller.signal);
		return () => controller.abort();
	}, [id, awaitingThumbnail]);

	// Falls back to the file icon if the thumbnail URL stops resolving.
	const [thumbnailFailed, setThumbnailFailed] = useState(false);

	if (!task) return null;

	const isDone = task.status === 'done';
	const isError = task.status === 'error';
	const pct = task.sizeBytes ? Math.round((task.bytesUploaded / task.sizeBytes) * 100) : 0;
	const link = isDone ? linkFor(task) : null;

	return (
		<li>
			<div className={`task-icon${isError ? ' task-icon-error' : ''}`}>
				{task.thumbnailUrl && !thumbnailFailed ? (
					<img className="task-thumb" src={task.thumbnailUrl} alt="" onError={() => setThumbnailFailed(true)} />
				) : (
					<FileIcon />
				)}
			</div>
			<div className="task-wrapper">
				<div className="task-info">
					<span className="file-name">{task.filename}</span>

					{isDone && <CheckIcon />}

					{!isDone && (
						<div className="task-actions">
							{task.status === 'uploading' && (
								<button type="button" className="icon-btn" aria-label="Pause" onClick={() => pauseUpload(id)}>
									<PauseIcon />
								</button>
							)}
							{task.status === 'paused' && (
								<button type="button" className="icon-btn" aria-label="Resume" onClick={() => resumeUpload(id)}>
									<PlayIcon />
								</button>
							)}
							<button type="button" className="icon-btn" aria-label="Cancel" onClick={() => cancelUpload(id)}>
								<TrashIcon />
							</button>
						</div>
					)}
				</div>

				<div className={`progress${isDone ? ' progress-done' : ''}${isError ? ' progress-error' : ''}`}>
					<div style={{ width: `${isError ? 100 : pct}%` }} />
				</div>

				<div className="task-status-row">
					{isError && (
						<>
							<span className="status-text status-text-error">{task.errorMessage ?? 'Upload failed! Please try again.'}</span>
							<button type="button" className="retry-btn" onClick={() => resumeUpload(id)}>
								Try again <RetryIcon />
							</button>
						</>
					)}
					{isDone && (
						<>
							<span className="status-text status-text-success">Upload successful!</span>
							<span className="status-pct">100%</span>
						</>
					)}
					{!isError && !isDone && (
						<>
							<span className="status-text">{formatBytes(task.sizeBytes)}</span>
							<span className="status-pct">{pct}%</span>
						</>
					)}
				</div>

				{link && (
					<div className="link-row">
						<a href={link} target="_blank" rel="noreferrer" className="link-url">
							{link}
						</a>
						<button type="button" className="copy" onClick={() => copyLink(link)}>
							Copy
						</button>
					</div>
				)}
			</div>
		</li>
	);
}
