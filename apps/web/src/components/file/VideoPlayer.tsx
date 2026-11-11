import { createPlayer, orientationLockFeature, selectError, usePlayer } from "@videojs/react";
import { HlsJsVideo } from "@videojs/react/media/hlsjs-video";
import { Video, videoFeatures } from "@videojs/react/video";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";

import { readSubtitleFile, SubtitleFileContext } from "@/components/file/subtitles";
import { videoBox } from "@/components/file/video-box";
import { VideoSkin } from "@/components/videojs/video/skin";

type Props = {
	// Presigned URL of the original file.
	src: string;
	// Master playlist once the transcode is done; null plays the original.
	hlsUrl: string | null;
	poster: string | null;
	// From the video-worker's probe; null until it has run.
	width: number | null;
	height: number | null;
	// A transcode is still running.
	pending: boolean;
	// Start playing once loaded (the viewer already pressed play on the preview).
	autoPlay?: boolean;
};

type Subtitle = { key: number; label: string; url: string };

// The video preset plus orientation lock, which no preset includes: going fullscreen on a phone turns the
// screen to the video's orientation, and leaving unlocks it. Android only; iOS doesn't let pages lock it.
const { Player } = createPlayer({ features: [...videoFeatures, orientationLockFeature] });

// Loaded by VideoPreview once the viewer presses play; the page doesn't render this directly.
// `pending` is shown by the preview.
export default function VideoPlayer({ src, hlsUrl, poster, width, height, autoPlay }: Props) {
	const box = videoBox(width, height);

	// The source is set only after the player has attached, so a failure while loading still reaches the
	// error handler below (a server-rendered src can start loading before hydration).
	const [attached, setAttached] = useState(false);
	useEffect(() => setAttached(true), []);

	// A stream that can't be played at all falls back to the original file.
	const [streamFailed, setStreamFailed] = useState(false);
	const useStream = Boolean(hlsUrl) && !streamFailed;
	const onPlaybackError = useCallback(() => {
		if (useStream) {
			console.error("HLS playback failed, falling back to the original");
			setStreamFailed(true);
		}
	}, [useStream]);

	const subtitles = useSubtitles();

	const tracks = subtitles.list.map((s, i) => (
		<track
			key={s.key}
			ref={i === subtitles.list.length - 1 ? subtitles.lastRef : undefined}
			kind="subtitles"
			label={s.label}
			src={s.url}
		/>
	));

	return (
		<SubtitleFileContext.Provider value={subtitles.context}>
			{/* Portrait videos (phone recordings) stay portrait in fullscreen; until the probe has run, landscape. */}
			<Player poster={poster ?? undefined} orientationLockType={width && height && height > width ? "portrait" : "landscape"}>
				<VideoSkin className="mx-auto" style={box}>
					{useStream ? (
						<HlsJsVideo src={attached ? hlsUrl! : undefined} playsInline autoPlay={autoPlay}>
							{tracks}
						</HlsJsVideo>
					) : (
						<Video src={attached ? src : undefined} playsInline autoPlay={autoPlay}>
							{tracks}
						</Video>
					)}
				</VideoSkin>
				<OnPlaybackError onError={onPlaybackError} />
			</Player>
			<input
				ref={subtitles.inputRef}
				type="file"
				accept=".srt,.vtt,text/vtt,application/x-subrip"
				hidden
				onChange={subtitles.onFileChange}
			/>
			{subtitles.error && <p className="mt-2 text-sm text-error" role="alert">{subtitles.error}</p>}
		</SubtitleFileContext.Provider>
	);
}

function OnPlaybackError({ onError }: { onError: () => void }) {
	const error = usePlayer(selectError)?.error;
	useEffect(() => {
		if (error) onError();
	}, [error, onError]);
	return null;
}

// Subtitle files the viewer picked, as <track>s. Each new file is switched on as it's added; the captions
// menu switches between them.
function useSubtitles() {
	const [list, setList] = useState<Subtitle[]>([]);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const lastRef = useRef<HTMLTrackElement>(null);
	const urls = useRef<string[]>([]);

	useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), []);

	useEffect(() => {
		const added = lastRef.current?.track;
		const media = lastRef.current?.parentElement as HTMLMediaElement | null;
		if (!added || !media) return;
		for (const t of media.textTracks) {
			if (t === added) t.mode = "showing";
			else if (t.kind === "subtitles" || t.kind === "captions") t.mode = "disabled";
		}
	}, [list]);

	const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
		const input = event.currentTarget;
		const file = input.files?.[0];
		input.value = "";
		if (!file) return;

		const vtt = await readSubtitleFile(file);
		if (!vtt) {
			setError(`Couldn't read ${file.name} as subtitles. Use an .srt or .vtt file.`);
			return;
		}
		setError(null);
		const url = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
		urls.current.push(url);
		setList((prev) => [...prev, { key: Date.now(), label: file.name.replace(/\.(srt|vtt)$/i, ""), url }]);
	};

	const context = useRef({ openPicker: () => inputRef.current?.click() }).current;

	return { list, error, inputRef, lastRef, onFileChange, context };
}
