/** @jsxImportSource react */

'use client';

import { selectTextTrack, usePlayer } from '@videojs/react';
import { CaptionsOffIcon } from '@videojs/react/icons';

import { useSubtitleFile } from '@/components/file/subtitles';
import { ButtonTooltip } from '@/components/videojs/ui/button-tooltip';
import { Button } from '@/components/videojs/ui/button';
import { CaptionsButton } from '@/components/videojs/ui/captions-button';

// The CC button. The skin's own captions button renders nothing until the video has a subtitle track, so
// until then this one opens the file picker instead. Once a track exists it's the usual on/off toggle;
// another file can be loaded from the captions menu.
export function SubtitlesButton() {
  const subtitleFile = useSubtitleFile();
  const hasCaptions = usePlayer(selectTextTrack)?.textTrackList.some(
    (track) => track.kind === 'subtitles' || track.kind === 'captions'
  );

  if (hasCaptions || !subtitleFile) {
    return (
      <ButtonTooltip side="top">
        <CaptionsButton />
      </ButtonTooltip>
    );
  }

  return (
    <ButtonTooltip side="top" label="Load subtitles">
      <Button type="button" aria-label="Load subtitles (.srt, .vtt)" onClick={subtitleFile.openPicker}>
        <CaptionsOffIcon className="size-media-icon drop-shadow-media-icon [text-shadow:inherit]" />
      </Button>
    </ButtonTooltip>
  );
}
