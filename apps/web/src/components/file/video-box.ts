// Capped at 75% of the screen's height so a portrait video fits without scrolling. Sized to the video's
// shape (16:9 until the probe has run): as wide as fits the height cap, never past the column or the
// video's own width. The preview and the player use the same box, so nothing moves when one replaces
// the other.
const MAX_HEIGHT = "75svh";

export function videoBox(width: number | null, height: number | null) {
	const [w, h] = width && height ? [width, height] : [16, 9];
	return {
		aspectRatio: `${w} / ${h}`,
		width: `min(100%, ${width ? `${width}px, ` : ""}calc(${MAX_HEIGHT} * ${w} / ${h}))`,
	};
}
