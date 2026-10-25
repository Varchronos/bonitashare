import { useState } from 'react';
import { formatBytes, type DeletedFile } from '@bonitashare/shared-types';
import { restoreFile } from '../../lib/files';
import FileThumb from './FileThumb';
import { RestoreIcon } from './icons';

// The recently deleted page's list. Rendered from the server's list once; a restore only changes the
// row it was clicked on, so nothing here refetches.
export default function DeletedFiles({ files }: { files: DeletedFile[] | null }) {
	if (!files) return <span className="text-sm text-error">Couldn't load your deleted files.</span>;
	if (files.length === 0) return <p className="text-sm text-on-surface-variant">Nothing deleted in the last day.</p>;

	return (
		<ul className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4">
			{files.map((file) => (
				<DeletedRow key={file.id} file={file} />
			))}
		</ul>
	);
}

function DeletedRow({ file }: { file: DeletedFile }) {
	const [restoring, setRestoring] = useState(false);
	const [restored, setRestored] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const isVideo = file.contentType?.startsWith('video/') ?? false;

	async function restore() {
		setRestoring(true);
		setError(null);
		try {
			await restoreFile(file.id);
			setRestored(true);
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setRestoring(false);
		}
	}

	return (
		<li className="card flex min-w-0 flex-col p-2 transition-colors hover:bg-surface-container-high">
			<FileThumb url={file.thumbnailUrl} isVideo={isVideo} />
			<div className="flex min-w-0 flex-1 flex-col gap-2 px-2 pt-3 pb-1">
				<span className="truncate text-sm font-medium text-on-surface">{file.filename}</span>
				<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
					{error ? (
						<span className="min-w-0 truncate text-xs text-error">{error}</span>
					) : restored ? (
						<span className="min-w-0 truncate text-xs text-success">
							Restored. <a href={`/f/${file.id}`} target='_blank' className="underline">Open it</a>
						</span>
					) : (
						<span className="min-w-0 truncate text-xs text-on-surface-variant">{formatBytes(file.sizeBytes)}</span>
					)}
					{!restored && (
						<span className="min-w-0 text-xs text-on-surface-variant">Restore before {new Date(file.purgeAfter).toLocaleString()}</span>
					)}
				</div>
				{/* mt-auto pins it to the card's bottom, so buttons line up across a grid row of uneven cards. */}
				{!restored && (
					<button
						type="button"
						className="btn mt-auto w-full bg-success-container text-on-success-container not-disabled:hover:shadow-sm disabled:cursor-progress disabled:opacity-70"
						disabled={restoring}
						onClick={restore}
					>
						<RestoreIcon className={restoring ? 'animate-spin [animation-direction:reverse]' : undefined} />
						{restoring ? 'Restoring…' : 'Restore'}
					</button>
				)}
			</div>
		</li>
	);
}
