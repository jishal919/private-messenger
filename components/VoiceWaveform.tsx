"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_BAR_COUNT,
  generateDeterministicWaveform,
  getAudioWaveformPeaks,
} from "@/lib/client/waveform";

interface VoiceWaveformProps {
  audioUrl: string;
  cacheKey: string;
  durationMs: number | null;
  progress: number; // 0 to 1
  isOwn: boolean;
  isPlaying: boolean;
  disabled?: boolean;
  onSeek: (ratio: number) => void;
}

export default function VoiceWaveform({
  audioUrl,
  cacheKey,
  durationMs,
  progress,
  isOwn,
  isPlaying,
  disabled,
  onSeek,
}: VoiceWaveformProps) {
  const barCount = 38;
  const [peaks, setPeaks] = useState<number[]>(() =>
    generateDeterministicWaveform(cacheKey, barCount)
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    if (audioUrl) {
      getAudioWaveformPeaks(audioUrl, cacheKey, barCount).then((loadedPeaks) => {
        if (!cancelled && loadedPeaks.length === barCount) {
          setPeaks(loadedPeaks);
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [audioUrl, cacheKey, barCount]);

  const handlePointerSeek = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;

      const clientX = e.clientX;
      const rawRatio = (clientX - rect.left) / rect.width;
      const clampedRatio = Math.max(0, Math.min(1, rawRatio));
      onSeek(clampedRatio);
    },
    [disabled, onSeek]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    isDraggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    handlePointerSeek(e);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingRef.current) {
      handlePointerSeek(e);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = 0.05;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onSeek(Math.max(0, progress - step));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onSeek(Math.min(1, progress + step));
    }
  };

  return (
    <div
      ref={containerRef}
      className={`voice-waveform-wrap ${isOwn ? "out" : "in"}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="Seek voice message"
      aria-valuenow={Math.round(progress * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      <div className="voice-waveform-bars" aria-hidden="true">
        {peaks.map((peak, index) => {
          const barPositionRatio = index / (barCount - 1);
          const isPlayed = barPositionRatio <= progress;
          // Calculate height from 15% (minimum) up to 100%
          const barHeightPercent = Math.max(15, Math.round(peak * 100));

          return (
            <span
              key={index}
              className={`voice-wave-bar ${isPlayed ? "played" : "unplayed"}`}
              style={{
                height: `${barHeightPercent}%`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
