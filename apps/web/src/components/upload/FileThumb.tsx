import { useState } from 'react';
import { FileIcon } from './icons';

// A row's thumbnail, or the file icon when there's none (or its URL stops resolving).
export default function FileThumb({ url, isVideo, isError = false }: { url: string | null | undefined; isVideo: boolean; isError?: boolean }) {
	const [failed, setFailed] = useState(false);

	return (
		// Inset at the top of the card, Drive-style: full width, 16:9, rounded on its own.
		<div
			className={`flex aspect-video w-full shrink-0 items-center justify-center overflow-hidden rounded-lg ${
				isError ? 'bg-error-container text-on-error-container' : 'bg-secondary-container text-on-secondary-container'
			}`}
		>
			{url && !failed ? (
				<img
					className={`size-full object-contain ${isVideo ? 'bg-black' : ''}`}
					src={url}
					alt=""
					onError={() => setFailed(true)}
				/>
			) : (
				<FileIcon />
			)}
		</div>
	);
}
