import { lazy, Suspense, useState, type ComponentProps } from "react";

import playIcon from "@/assets/play.svg?raw";
import { videoBox } from "@/components/file/video-box";

// The player (video.js and hls.js) is most of the page's script, so it loads only once the viewer
// presses play. Until then the page shows the thumbnail and a play button.
const loadPlayer = () => import("@/components/file/VideoPlayer");
const VideoPlayer = lazy(loadPlayer);

type Props = Omit<ComponentProps<typeof VideoPlayer>, "autoPlay">;

export default function VideoPreview(props: Props) {
	const [started, setStarted] = useState(false);

	const poster = (
		<Poster
			url={props.poster}
			box={videoBox(props.width, props.height)}
			loading={started}
			// Start fetching on hover or touch, so the player is often ready by the time the click lands.
			onIntent={loadPlayer}
			onPlay={() => setStarted(true)}
		/>
	);

	return (
		<>
			{started ? (
				<Suspense fallback={poster}>
					{/* Plays as soon as it's ready: the click counts as the viewer's go-ahead for sound. */}
					<VideoPlayer {...props} autoPlay />
				</Suspense>
			) : (
				poster
			)}
			{props.pending && !props.hlsUrl && (
				<p className="mt-2 text-sm text-on-surface-variant">A streaming version is still processing. Playing the original for now.</p>
			)}
		</>
	);
}

type PosterProps = {
	url: string | null;
	box: ReturnType<typeof videoBox>;
	loading: boolean;
	onIntent: () => void;
	onPlay: () => void;
};

function Poster({ url, box, loading, onIntent, onPlay }: PosterProps) {
	const [failed, setFailed] = useState(false);

	return (
		<button
			type="button"
			aria-label="Play video"
			className="group relative mx-auto block cursor-pointer overflow-hidden rounded-[28px] bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
			style={box}
			disabled={loading}
			onPointerEnter={onIntent}
			onTouchStart={onIntent}
			onFocus={onIntent}
			onClick={onPlay}
		>
			{url && !failed && (
				// The likely largest thing on the page, so it's fetched first.
				<img className="size-full object-contain" src={url} alt="" fetchPriority="high" decoding="async" onError={() => setFailed(true)} />
			)}
			<span className="absolute inset-0 flex items-center justify-center">
				<span className="flex size-16 items-center justify-center rounded-full bg-black/60 text-white transition-transform group-hover:scale-110 group-disabled:scale-100">
					{loading ? (
						<span className="size-7 animate-spin rounded-full border-3 border-white/30 border-t-white" aria-hidden="true" />
					) : (
						<span aria-hidden="true" className="inline-flex [&>svg]:size-8 [&>svg]:fill-current" dangerouslySetInnerHTML={{ __html: playIcon }} />
					)}
				</span>
			</span>
		</button>
	);
}
