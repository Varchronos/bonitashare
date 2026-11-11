import { useEffect, useRef, useState } from 'react';
import type { FilePage, Usage } from '@bonitashare/shared-types';
import { useUploadStore } from '../../store/file-store';
import { INTERRUPTED_MESSAGE, addIncompleteUploads, enqueueFile, isUploadFinished } from '../../lib/upload-task';
import { useUsageStore } from '../../store/usage-store';
import { fetchIncompleteUploads } from '../../lib/files';
import TaskList from './TaskList';
import TierInfo from './TierInfo';
import UsageMeter from './UsageMeter';
import UserFiles from './UserFiles';

// `files` is the first page of the user's finished uploads; the list is shown only when it's passed.
// Null means the page tried and the API failed. `filesLimit` cuts the list short with a link to the
// upload page for the rest (the homepage's recent uploads).
export default function FileUpload({
	usage,
	files,
	filesLimit,
}: {
	usage: Usage | null;
	files?: FilePage | null;
	filesLimit?: number;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	// Shown only if the incomplete-uploads request is still out after a moment, so a fast one doesn't flash it.
	const [checkingIncomplete, setCheckingIncomplete] = useState(false);

	// Into the store on mount, not during render: on the server the store is shared by every request.
	useEffect(() => {
		if (usage) useUsageStore.getState().setUsage(usage);
	}, [usage]);

	useEffect(() => {
		// The store loads asynchronously from IndexedDB (skipHydration), and
		// whatever it restores has no live tus.Upload/File backing it in this
		// fresh session. They're shown as interrupted instead: adding the same
		// file again continues them (see enqueueFile).
		useUploadStore.persist.rehydrate()?.then(() => {
			const { files: tasks, updateFile, removeFile } = useUploadStore.getState();
			for (const task of tasks) {
				// Saved before finished uploads stopped being persisted; the server's list has these now.
				if (task.status === 'done') {
					removeFile(task.id);
				} else if (task.status === 'queued' || task.status === 'uploading' || task.status === 'paused') {
					updateFile(task.id, { status: 'error', errorMessage: INTERRUPTED_MESSAGE });
					// Unless it had in fact finished just before the reload.
					isUploadFinished(task).then((finished) => {
						if (finished) updateFile(task.id, { status: 'done', bytesUploaded: task.sizeBytes, errorMessage: null });
					});
				}
			}
			// After the restore, so uploads this browser already knows about aren't added twice. A failed
			// fetch just leaves them unlisted until the next page load.
			const showLoader = setTimeout(() => setCheckingIncomplete(true), 300);
			fetchIncompleteUploads()
				.then(addIncompleteUploads, () => {})
				.finally(() => {
					clearTimeout(showLoader);
					setCheckingIncomplete(false);
				});
		});
	}, []);

	function enqueue(list: FileList | null) {
		if (!list?.length) return;
		// One at a time: each queued file reserves its size, so the next one is checked against what's left.
		for (const file of Array.from(list)) enqueueFile(file);
	}

	return (
		<div className="flex w-full min-w-0 flex-col gap-4">
			{/* Dropzone first, two thirds of the row; on phones a column reversed, so the meter sits on top. */}
			<div className="flex flex-col-reverse gap-4 md:flex-row">
				<div
					className="flex min-w-0 cursor-pointer flex-col items-center justify-center gap-1 md:flex-2 rounded-[28px] border-2 border-dashed border-outline-variant bg-surface-container-low px-4 py-12 text-center text-on-surface-variant transition-colors duration-150 hover:border-primary hover:bg-surface-container focus-visible:border-primary focus-visible:bg-surface-container focus-visible:outline-none"
					role="button"
					tabIndex={0}
					onClick={() => inputRef.current?.click()}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							inputRef.current?.click();
						}
					}}
					onDragOver={(e) => e.preventDefault()}
					onDrop={(e) => {
						e.preventDefault();
						enqueue(e.dataTransfer.files);
					}}
				>
					<div className="mb-3 flex size-16 items-center justify-center rounded-full bg-primary-container text-on-primary-container">
						<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
							<path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
					</div>
					<p className="text-base font-medium text-on-surface">Drag &amp; drop files here</p>
					<p className="text-sm">or click to browse — uploads start right away</p>
					<input
						ref={inputRef}
						type="file"
						multiple
						hidden
						onChange={(e) => {
							enqueue(e.target.files);
							e.target.value = '';
						}}
					/>
				</div>
				{/* empty:hidden: both render nothing without usage, and the dropzone then takes the row. */}
				<div className="flex min-w-0 flex-col gap-4 empty:hidden md:flex-1">
					<UsageMeter initial={usage} />
					<TierInfo initial={usage} />
				</div>
			</div>

			{checkingIncomplete && (
				<p role="status" className="flex items-center gap-2 text-sm text-on-surface-variant">
					<svg className="size-4 animate-spin text-primary" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" className="opacity-25" />
						<path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
					</svg>
					Checking for interrupted uploads…
				</p>
			)}
			<TaskList />
			{files !== undefined && <UserFiles initial={files} limit={filesLimit} />}
		</div>
	);
}
