import { useRef, useState, type DragEvent } from 'react';
import * as tus from 'tus-js-client';
import './FileUpload.css';

type UploadedLink = { file: string; url: string };

type Status =
	| { kind: 'idle' }
	| { kind: 'uploading'; progress: number }
	| { kind: 'paused'; progress: number }
	| { kind: 'cancelled' }
	| { kind: 'done'; links: UploadedLink[] }
	| { kind: 'error'; message: string; links: UploadedLink[] };

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

// One resumable tus upload. Chunked (rather than sent in one shot) so a
// dropped connection only costs the in-flight chunk — retryDelays then
// resumes from the last accepted offset instead of restarting the file.
function uploadOne(file: File, onBytesSent: (bytesUploaded: number) => void): Promise<string> {
	return new Promise((resolve, reject) => {
		const upload = new tus.Upload(file, {
			endpoint: '/api/upload',
			metadata: { filename: file.name, filetype: file.type },
			chunkSize: 5 * 1024 * 1024,
			retryDelays: [0, 1000, 3000, 5000],
			onProgress: (bytesSent) => onBytesSent(bytesSent),
			onError: (err) => reject(err),
			onSuccess: () => {
				const id = upload.url?.split('/').filter(Boolean).pop();
				if (!id) {
					reject(new Error('Upload finished without a resulting file id'));
					return;
				}
				resolve(`${window.location.origin}/${id}`);
			},
		});
		upload.start();
	});
}

// Uploaded one at a time rather than in parallel, so a batch of files
// doesn't fan out into N simultaneous connections through the proxy.
async function uploadFiles(files: File[], onProgress: (pct: number) => void): Promise<UploadedLink[]> {
	const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
	let bytesDoneBefore = 0;
	const links: UploadedLink[] = [];

	for (const file of files) {
		const url = await uploadOne(file, (bytesSent) => {
			const pct = totalBytes ? Math.round(((bytesDoneBefore + bytesSent) / totalBytes) * 100) : 100;
			onProgress(pct);
		});
		bytesDoneBefore += file.size;
		links.push({ file: file.name, url });
	}

	return links;
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
			const links = await uploadFiles(files, (progress) => setStatus({ kind: 'uploading', progress }));
			setStatus({ kind: 'done', links });
			setFiles([]);
		} catch (err) {
			setStatus({ kind: 'error', message: (err as Error).message, links: [] });
		}
	}

	async function copyLink(url: string) {
		try {
			await navigator.clipboard.writeText(url);
		} catch {
			// Clipboard access can be denied (permissions, insecure context) —
			// the link is still shown and selectable, so this is non-fatal.
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

			{status.kind === 'done' && (
				<ul className="link-list">
					{status.links.map((link) => (
						<li key={link.url}>
							<span className="link-name">{link.file}</span>
							<a href={link.url} className="link-url">
								{link.url}
							</a>
							<button type="button" className="copy" onClick={() => copyLink(link.url)}>
								Copy
							</button>
						</li>
					))}
				</ul>
			)}
			{status.kind === 'error' && <p className="status error">{status.message}</p>}

			<button type="button" className="btn btn-primary upload-btn" disabled={!files.length || uploading} onClick={onUpload}>
				{uploading ? `Uploading… ${status.progress}%` : `Upload${files.length ? ` ${files.length} file${files.length > 1 ? 's' : ''}` : ''}`}
			</button>
		</div>
	);
}
