/** @jsxImportSource react */

'use client';

import { usePlayer } from '@videojs/react/video';
import { useEffect, useRef } from 'react';

// Space between the bottom of the subtitles and the top of the control bar, or the video's bottom edge
// while the controls are hidden. The same gap either way.
const GAP_PX = 74;

// Browsers draw subtitles inside the <video>, along its bottom edge, which is where the control bar sits.
// This lifts them by the bar's measured height plus a gap. Subtitles are anchored by their bottom edge, so
// extra lines grow upward and stay clear of the controls however many there are.
//
// Two ways to move them, depending on the browser:
// - Chromium: translate the box the browser draws cues in, through the skin's --media-caption-track-y
//   (styles/video/captions.css). Chromium has no VTTCue.lineAlign, so the cue route can't anchor by the
//   bottom edge there.
// - Firefox and Safari: position every cue (line as a percentage, lineAlign 'end'). Firefox has no styleable
//   cue box, so this is the only route there; the CSS offset is zeroed so Safari isn't moved twice.
export function SubtitlesAboveControls() {
  const marker = useRef<HTMLSpanElement>(null);
  const controlsVisible = usePlayer((s) => s.controlsVisible) ?? false;

  useEffect(() => {
    const root = marker.current?.closest<HTMLElement>('.media-skin');
    if (!root) return;
    const positionCues = typeof VTTCue !== 'undefined' && 'lineAlign' in VTTCue.prototype;

    const place = () => {
      const video = root.querySelector('video');
      if (!video?.offsetHeight) return;

      let lift = GAP_PX;
      if (controlsVisible) {
        for (const bar of root.querySelectorAll<HTMLElement>('[data-subtitle-floor]')) {
          // The bars switch between display: contents and a real box with the player's width; only one
          // has a box at a time. Offsets ignore the bars' show/hide transforms, unlike getBoundingClientRect.
          if (!bar.offsetHeight || bar.offsetParent !== video.offsetParent) continue;
          lift = Math.max(lift, video.offsetTop + video.offsetHeight - bar.offsetTop + GAP_PX);
        }
      }

      video.style.setProperty('--media-caption-track-y', positionCues ? '0px' : `${-lift}px`);
      if (!positionCues) return;

      const line = Math.max(0, 100 * (1 - lift / video.offsetHeight));
      for (const track of video.textTracks) {
        if ((track.kind !== 'subtitles' && track.kind !== 'captions') || !track.cues) continue;
        for (const cue of track.cues) {
          if (!(cue instanceof VTTCue) || (cue.line === line && !cue.snapToLines)) continue;
          cue.snapToLines = false;
          cue.line = line;
          cue.lineAlign = 'end';
        }
      }
    };

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };

    place();
    const resize = new ResizeObserver(schedule);
    resize.observe(root);
    // A swapped <video> (the stream falling back to the original) or new <track>s.
    const mutations = new MutationObserver(schedule);
    mutations.observe(root, { childList: true, subtree: true });
    // A <track> finishing loading: its cues exist only from here. 'load' doesn't bubble, so capture it.
    root.addEventListener('load', schedule, true);

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      root.removeEventListener('load', schedule, true);
    };
  }, [controlsVisible]);

  return <span ref={marker} hidden />;
}
