import { useState } from 'react';
import { formatBytes, type DeletedFile } from '@bonitashare/shared-types';
import { restoreFile } from '../../lib/files';
import { FileIcon } from './icons';
import './FileUpload.css';

// The recently deleted page's list. Rendered from the server's list once; a restore only changes the
// row it was clicked on, so nothing here refetches.
export default function DeletedFiles({ files }: { files: DeletedFile[] | null }) {
	if (!files) return <span className="status-text status-text-error">Couldn't load your deleted files.</span>;
	if (files.length === 0) return <p className="status-text">Nothing deleted in the last day.</p>;

	return (
		<ul className="file-list">
			{files.map((file) => (
				<DeletedRow key={file.id} file={file} />
			))}
		</ul>
	);
}

function DeletedRow({ file }: { file: DeletedFile }) {
	const [thumbnailFailed, setThumbnailFailed] = useState(false);
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
					{!restored && (
						<button type="button" className="copy" disabled={restoring} onClick={restore}>
							{restoring ? 'Restoring…' : 'Restore'}
						</button>
					)}
				</div>
				<div className="task-status-row">
					{error ? (
						<span className="status-text status-text-error">{error}</span>
					) : restored ? (
						<span className="status-text status-text-success">
							Restored. <a href={`/f/${file.id}`}>Open it</a>
						</span>
					) : (
						<span className="status-text">{formatBytes(file.sizeBytes)}</span>
					)}
					{!restored && (
						<span className="status-pct">Restorable until {new Date(file.purgeAfter).toLocaleString()}</span>
					)}
				</div>
			</div>
		</li>
	);
}
