/**
 * Global audio playback coordinator to ensure only one voice message
 * plays at a time across the entire application.
 */

type AudioPauseCallback = () => void;

let currentlyPlayingCallback: AudioPauseCallback | null = null;

export function registerPlayingAudio(pauseCallback: AudioPauseCallback): () => void {
  if (currentlyPlayingCallback && currentlyPlayingCallback !== pauseCallback) {
    try {
      currentlyPlayingCallback();
    } catch {
      // ignore
    }
  }

  currentlyPlayingCallback = pauseCallback;

  return () => {
    if (currentlyPlayingCallback === pauseCallback) {
      currentlyPlayingCallback = null;
    }
  };
}

export function unregisterPlayingAudio(pauseCallback: AudioPauseCallback): void {
  if (currentlyPlayingCallback === pauseCallback) {
    currentlyPlayingCallback = null;
  }
}
