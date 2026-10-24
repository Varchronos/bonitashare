import { useState } from 'react';
import { formatBytes, type DeletedFile } from '@bonitashare/shared-types';
import { restoreFile } from '../../lib/files';
import FileThumb from './FileThumb';
import * as ui from './ui';

// The recently deleted page's list. Rendered from the server's list once; a restore only changes the
// row it was clicked on, so nothing here refetches.
export default function DeletedFiles({ files }: { files: DeletedFile[] | null }) {
	if (!files) return <span className={ui.statusText('error')}>Couldn't load your deleted files.</span>;
	if (files.length === 0) return <p className={ui.statusText()}>Nothing deleted in the last day.</p>;

	return (
		<ul className="flex flex-col gap-2">
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
		<li className={ui.row}>
			<FileThumb url={file.thumbnailUrl} isVideo={isVideo} />
			<div className={ui.rowBody}>
				<div className={ui.rowLine}>
					<span className={ui.fileName}>{file.filename}</span>
					{!restored && (
						<button type="button" className={ui.smallButton} disabled={restoring} onClick={restore}>
							{restoring ? 'Restoring…' : 'Restore'}
						</button>
					)}
				</div>
				<div className={ui.rowLine}>
					{error ? (
						<span className={ui.statusText('error')}>{error}</span>
					) : restored ? (
						<span className={ui.statusText('success')}>
							Restored. <a href={`/f/${file.id}`} className="underline">Open it</a>
						</span>
					) : (
						<span className={ui.statusText()}>{formatBytes(file.sizeBytes)}</span>
					)}
					{!restored && (
						<span className={ui.statusAside}>Restorable until {new Date(file.purgeAfter).toLocaleString()}</span>
					)}
				</div>
			</div>
		</li>
	);
}
