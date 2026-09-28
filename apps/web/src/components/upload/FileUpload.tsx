import { useRef, useState, type DragEvent } from 'react';
import type { ApiResponse } from '@bonitashare/shared-types';
import './FileUpload.css';

type Status =
	| { kind: 'idle' }
	| { kind: 'uploading'; progress: number }
	| { kind: 'done' }
	| { kind: 'error'; message: string };

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

// XHR instead of fetch: fetch still has no upload-progress events.
function uploadFiles(files: File[], onProgress: (pct: number) => void) {
	return new Promise<void>((resolve, reject) => {
		const form = new FormData();
		for (const file of files) form.append('file', file, file.name);

		const xhr = new XMLHttpRequest();
		xhr.open('POST', '/api/upload');
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
		};
		xhr.onload = () => {
			if (xhr.status >= 200 && xhr.status < 300) return resolve();
			let message = `Upload failed (${xhr.status})`;
			try {
				const body = JSON.parse(xhr.responseText) as ApiResponse<unknown>;
				if (body.error) message = body.error.message;
			} catch {}
			reject(new Error(message));
		};
		xhr.onerror = () => reject(new Error('Network error'));
		xhr.send(form);
	});
}

export default function FileUpload() {
	const inputRef = useRef<HTMLInputElement>(null);
	const [files, setFiles] = useState<File[]>([]);
	const [dragging, setDragging] = useState(false);
	const [status, setStatus] = useState<Status>({ kind: 'idle' });

	const uploading = status.kind === 'uploading';

	function addFiles(list: FileList | null) {
		if (!list?.length) return;
		setFiles((prev) => [...prev, ...Array.from(list)]);
		setStatus({ kind: 'idle' });
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		setDragging(false);
		if (!uploading) addFiles(e.dataTransfer.files);
	}

	async function onUpload() {
		setStatus({ kind: 'uploading', progress: 0 });
		try {
			await uploadFiles(files, (progress) => setStatus({ kind: 'uploading', progress }));
			setStatus({ kind: 'done' });
			setFiles([]);
		} catch (err) {
			setStatus({ kind: 'error', message: (err as Error).message });
		}
	}

	return (
		<div className="uploader">
			<div
				className={`dropzone${dragging ? ' dragging' : ''}`}
				role="button"
				tabIndex={0}
				aria-disabled={uploading}
				onClick={() => !uploading && inputRef.current?.click()}
				onKeyDown={(e) => {
					if ((e.key === 'Enter' || e.key === ' ') && !uploading) {
						e.preventDefault();
						inputRef.current?.click();
					}
				}}
				onDragOver={(e) => {
					e.preventDefault();
					setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={onDrop}
			>
				<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
					<path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
				<p className="dropzone-title">Drag &amp; drop files here</p>
				<p className="dropzone-hint">or click to browse</p>
				<input
					ref={inputRef}
					type="file"
					multiple
					hidden
					onChange={(e) => {
						addFiles(e.target.files);
						e.target.value = '';
					}}
				/>
			</div>

			{files.length > 0 && (
				<ul className="file-list">
					{files.map((file, i) => (
						<li key={`${file.name}-${i}`}>
							<span className="file-name">{file.name}</span>
							<span className="file-size">{formatBytes(file.size)}</span>
							<button
								type="button"
								className="remove"
								aria-label={`Remove ${file.name}`}
								disabled={uploading}
								onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
							>
								×
							</button>
						</li>
					))}
				</ul>
			)}

			{uploading && (
				<div className="progress" role="progressbar" aria-valuenow={status.progress} aria-valuemin={0} aria-valuemax={100}>
					<div style={{ width: `${status.progress}%` }} />
				</div>
			)}

			{status.kind === 'done' && <p className="status success">Upload complete.</p>}
			{status.kind === 'error' && <p className="status error">{status.message}</p>}

			<button type="button" className="btn btn-primary upload-btn" disabled={!files.length || uploading} onClick={onUpload}>
				{uploading ? `Uploading… ${status.progress}%` : `Upload${files.length ? ` ${files.length} file${files.length > 1 ? 's' : ''}` : ''}`}
			</button>
		</div>
	);
}
