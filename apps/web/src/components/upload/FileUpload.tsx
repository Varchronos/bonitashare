import { useEffect, useRef } from 'react';
import type { FilePage, Usage } from '@bonitashare/shared-types';
import { useUploadStore } from '../../store/file-store';
import { enqueueFile, isUploadFinished } from '../../lib/upload-task';
import { quotaProblem, useUsageStore } from '../../store/usage-store';
import TaskList from './TaskList';
import UsageMeter from './UsageMeter';
import UserFiles from './UserFiles';

// `files` is the first page of the user's finished uploads; the list is shown only when it's passed
// (the upload page does, the homepage hero doesn't). Null means the page tried and the API failed.
export default function FileUpload({ usage, files }: { usage: Usage | null; files?: FilePage | null }) {
	const inputRef = useRef<HTMLInputElement>(null);

	// Into the store on mount, not during render: on the server the store is shared by every request.
	useEffect(() => {
		if (usage) useUsageStore.getState().setUsage(usage);
	}, [usage]);

	useEffect(() => {
		// The store loads asynchronously from IndexedDB (skipHydration), and
		// whatever it restores has no live tus.Upload/File backing it in this
		// fresh session — there's nothing to actually resume, so be honest
		// about it instead of showing dead pause/resume controls.
		useUploadStore.persist.rehydrate()?.then(() => {
			const { files, updateFile, removeFile } = useUploadStore.getState();
			for (const task of files) {
				// Saved before finished uploads stopped being persisted; the server's list has these now.
				if (task.status === 'done') {
					removeFile(task.id);
				} else if (task.status === 'queued' || task.status === 'uploading' || task.status === 'paused') {
					updateFile(task.id, { status: 'error', errorMessage: 'Interrupted by a page reload — please re-add this file.' });
					// Unless it had in fact finished just before the reload.
					isUploadFinished(task).then((finished) => {
						if (finished) updateFile(task.id, { status: 'done', bytesUploaded: task.sizeBytes, errorMessage: null });
					});
				}
			}
		});
	}, []);

	function enqueue(list: FileList | null) {
		if (!list?.length) return;
		// One at a time: each queued file reserves its size, so the next one is checked against what's left.
		for (const file of Array.from(list)) enqueueFile(file, quotaProblem(file.size));
	}

	return (
		<div className="flex w-full min-w-0 flex-col gap-4">
			<UsageMeter initial={usage} />

			<div
				className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed border-border bg-surface px-4 py-10 text-center text-muted transition-colors duration-150 hover:border-accent hover:bg-accent-soft focus-visible:border-accent focus-visible:bg-accent-soft focus-visible:outline-none"
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
				<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
					<path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
				<p className="mt-2 font-semibold text-fg">Drag &amp; drop files here</p>
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

			<TaskList />
			{files !== undefined && <UserFiles initial={files} />}
		</div>
	);
}
