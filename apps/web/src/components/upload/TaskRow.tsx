import { useEffect } from 'react';
import { formatBytes } from '@bonitashare/shared-types';
import { useUploadStore, type UploadTask } from '../../store/file-store';
import { pauseUpload, resumeUpload, cancelUpload, shareIdFor, watchThumbnail } from '../../lib/upload-task';
import { TrashIcon, CheckIcon, PauseIcon, PlayIcon, RetryIcon } from './icons';
import FileThumb from './FileThumb';
import ShareLinks from './ShareLinks';
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
		<li className="card flex min-w-0 flex-col p-2 transition-colors hover:bg-surface-container-high">
			<FileThumb url={task.thumbnailUrl} isVideo={isVideo} isError={isError} />
			<div className="flex min-w-0 flex-1 flex-col gap-2 px-2 pt-3 pb-1">
				<div className="flex items-center justify-between gap-3">
					<span className="min-w-0 flex-1 truncate text-sm font-medium text-on-surface">{task.filename}</span>

					{isDone && (
						<div className="-mr-1 flex shrink-0 items-center">
							<span className="flex size-8 items-center justify-center text-success">
								<CheckIcon />
							</span>
							<button type="button" className="icon-btn icon-btn-sm hover:text-error" aria-label="Delete" disabled={deleting} onClick={remove}>
								<TrashIcon />
							</button>
						</div>
					)}

					{!isDone && (
						<div className="-mr-1 flex shrink-0 items-center">
							{task.status === 'uploading' && (
								<button type="button" className="icon-btn icon-btn-sm hover:text-error" aria-label="Pause" onClick={() => pauseUpload(id)}>
									<PauseIcon />
								</button>
							)}
							{task.status === 'paused' && (
								<button type="button" className="icon-btn icon-btn-sm hover:text-error" aria-label="Resume" onClick={() => resumeUpload(id)}>
									<PlayIcon />
								</button>
							)}
							<button type="button" className="icon-btn icon-btn-sm hover:text-error" aria-label="Cancel" onClick={() => cancelUpload(id)}>
								<TrashIcon />
							</button>
						</div>
					)}
				</div>

				{/* M3 linear progress: a 4px indicator on a tonal track. */}
				<div className="h-1 overflow-hidden rounded-full bg-secondary-container">
					<div
						className={`h-full rounded-full transition-[width] duration-100 ${isError ? 'bg-error' : isDone ? 'bg-success' : 'bg-primary'}`}
						style={{ width: `${isError ? 100 : pct}%` }}
					/>
				</div>

				<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
					{isError && (
						<>
							<span className="min-w-0 truncate text-xs text-error">{task.errorMessage ?? 'Upload failed! Please try again.'}</span>
							<button type="button" className="btn btn-text btn-sm -mr-2 px-2" onClick={() => resumeUpload(id)}>
								Try again <RetryIcon />
							</button>
						</>
					)}
					{isDone && (
						<>
							{deleteError ? (
								<span className="min-w-0 truncate text-xs text-error">{deleteError}</span>
							) : (
								<span className="min-w-0 truncate text-xs text-success">Upload successful!</span>
							)}
							<span className="shrink-0 text-xs text-on-surface-variant">100%</span>
						</>
					)}
					{!isError && !isDone && (
						<>
							<span className="min-w-0 truncate text-xs text-on-surface-variant">{formatBytes(task.sizeBytes)}</span>
							<span className="shrink-0 text-xs text-on-surface-variant">{pct}%</span>
						</>
					)}
				</div>

				{link && (
					<>
						<a href={link} target="_blank" rel="noreferrer" className="truncate text-xs text-primary hover:underline">
							{link}
						</a>
						<div className="flex flex-wrap items-center gap-1">
							<button type="button" className="btn btn-tonal btn-sm" onClick={() => copyLink(link)}>
								Copy
							</button>
							<ShareLinks link={link} />
						</div>
					</>
				)}
			</div>
		</li>
	);
}
