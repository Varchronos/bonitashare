import { useEffect } from 'react';
import { formatBytes } from '@bonitashare/shared-types';
import { useUploadStore, type UploadTask } from '../../store/file-store';
import { pauseUpload, resumeUpload, cancelUpload, shareIdFor, watchThumbnail } from '../../lib/upload-task';
import { TrashIcon, CheckIcon, PauseIcon, PlayIcon, RetryIcon } from './icons';
import FileThumb from './FileThumb';
import * as ui from './ui';
import { useDeleteFile } from './useDeleteFile';

function linkFor(task: UploadTask) {
	const id = shareIdFor(task);
	return id ? `${window.location.origin}/f/${id}` : null;
}

export async function copyLink(url: string) {
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

	// Images get a thumbnail and videos a poster frame; other types never poll.
	const isVideo = task?.contentType.startsWith('video/') ?? false;
	const awaitingThumbnail =
		task?.status === 'done' && !task.thumbnailUrl && (task.contentType.startsWith('image/') || isVideo);
	useEffect(() => {
		if (!awaitingThumbnail) return;
		const controller = new AbortController();
		watchThumbnail(id, controller.signal);
		return () => controller.abort();
	}, [id, awaitingThumbnail]);

	// Only reachable once done, when the upload has a share id to delete by.
	const { remove, deleting, error: deleteError } = useDeleteFile(
		task?.tusUploadUrl ? shareIdFor(task) : null,
		task?.filename ?? '',
		() => useUploadStore.getState().removeFile(id),
	);

	if (!task) return null;

	const isDone = task.status === 'done';
	const isError = task.status === 'error';
	const pct = task.sizeBytes ? Math.round((task.bytesUploaded / task.sizeBytes) * 100) : 0;
	const link = isDone ? linkFor(task) : null;

	return (
		<li className={ui.row}>
			<FileThumb url={task.thumbnailUrl} isVideo={isVideo} isError={isError} />
			<div className={ui.rowBody}>
				<div className={ui.rowLine}>
					<span className={ui.fileName}>{task.filename}</span>

					{isDone && (
						<div className={ui.rowActions}>
							<CheckIcon />
							<button type="button" className={ui.iconButton} aria-label="Delete" disabled={deleting} onClick={remove}>
								<TrashIcon />
							</button>
						</div>
					)}

					{!isDone && (
						<div className={ui.rowActions}>
							{task.status === 'uploading' && (
								<button type="button" className={ui.iconButton} aria-label="Pause" onClick={() => pauseUpload(id)}>
									<PauseIcon />
								</button>
							)}
							{task.status === 'paused' && (
								<button type="button" className={ui.iconButton} aria-label="Resume" onClick={() => resumeUpload(id)}>
									<PlayIcon />
								</button>
							)}
							<button type="button" className={ui.iconButton} aria-label="Cancel" onClick={() => cancelUpload(id)}>
								<TrashIcon />
							</button>
						</div>
					)}
				</div>

				<div className="h-1.5 overflow-hidden rounded-full bg-border">
					<div
						className={`h-full transition-[width] duration-100 ${isError ? 'bg-danger' : isDone ? 'bg-success' : 'bg-accent'}`}
						style={{ width: `${isError ? 100 : pct}%` }}
					/>
				</div>

				<div className={ui.rowLine}>
					{isError && (
						<>
							<span className={ui.statusText('error')}>{task.errorMessage ?? 'Upload failed! Please try again.'}</span>
							<button type="button" className="flex shrink-0 cursor-pointer items-center gap-1 text-sm font-medium text-accent hover:text-accent-hover" onClick={() => resumeUpload(id)}>
								Try again <RetryIcon />
							</button>
						</>
					)}
					{isDone && (
						<>
							{deleteError ? (
								<span className={ui.statusText('error')}>{deleteError}</span>
							) : (
								<span className={ui.statusText('success')}>Upload successful!</span>
							)}
							<span className={ui.statusAside}>100%</span>
						</>
					)}
					{!isError && !isDone && (
						<>
							<span className={ui.statusText()}>{formatBytes(task.sizeBytes)}</span>
							<span className={ui.statusAside}>{pct}%</span>
						</>
					)}
				</div>

				{link && (
					<div className={ui.linkRow}>
						<a href={link} target="_blank" rel="noreferrer" className={ui.linkUrl}>
							{link}
						</a>
						<button type="button" className={ui.smallButton} onClick={() => copyLink(link)}>
							Copy
						</button>
					</div>
				)}
			</div>
		</li>
	);
}
