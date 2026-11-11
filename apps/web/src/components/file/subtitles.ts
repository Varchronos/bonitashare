import { createContext, useContext } from "react";

// Subtitles a viewer loads from their own device; nothing is uploaded. The player provides this, and the
// CC button and the captions menu (in the Video.js skin) use it to open the file picker.
export const SubtitleFileContext = createContext<{ openPicker: () => void } | null>(null);

export function useSubtitleFile() {
	return useContext(SubtitleFileContext);
}

// Browsers only play WebVTT in <track>. SRT differs mainly in the header and the decimal comma in
// timestamps, so it's converted here instead of on the server.
function srtToVtt(srt: string): string {
	return `WEBVTT\n\n${srt.replace(/\r\n?/g, "\n").replace(/(\d+:\d{2}:\d{2}),(\d{3})/g, "$1.$2")}`;
}

// Many older SRT files are Windows-1252, not UTF-8; reading them as UTF-8 mangles accented letters.
function decode(bytes: ArrayBuffer): string {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return new TextDecoder("windows-1252").decode(bytes);
	}
}

// WebVTT text for an .srt or .vtt file, or null if it has no cues at all (not a subtitle file).
export async function readSubtitleFile(file: File): Promise<string | null> {
	const text = decode(await file.arrayBuffer()).replace(/^﻿/, "");
	if (!text.includes("-->")) return null;
	return text.startsWith("WEBVTT") ? text : srtToVtt(text);
}
