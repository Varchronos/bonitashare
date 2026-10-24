import { useState } from 'react';
import { FileIcon } from './icons';

// A row's thumbnail, or the file icon when there's none (or its URL stops resolving).
export default function FileThumb({ url, isVideo, isError = false }: { url: string | null | undefined; isVideo: boolean; isError?: boolean }) {
	const [failed, setFailed] = useState(false);

	return (
		// Videos are 16:9 so a landscape poster shows whole instead of cropped to a square; a portrait one
		// is pillarboxed. Same height as the square icon, so rows stay aligned.
		<div
			className={`flex h-10 shrink-0 items-center justify-center rounded-lg ${isVideo ? 'aspect-video' : 'w-10'} ${
				isError ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent'
			}`}
		>
			{url && !failed ? (
				<img
					className={`size-full rounded-[inherit] ${isVideo ? 'bg-black object-contain' : 'object-cover'}`}
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
