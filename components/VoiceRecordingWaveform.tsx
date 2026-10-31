"use client";

import { useEffect, useRef } from "react";

interface VoiceRecordingWaveformProps {
  stream: MediaStream | null;
}

export default function VoiceRecordingWaveform({
  stream,
}: VoiceRecordingWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!stream) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextClass) return;

    let audioContext: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let animationFrameId: number | null = null;

    try {
      audioContext = new AudioContextClass();
      source = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();

      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);
    } catch (err) {
      console.warn("Could not start AudioContext for live waveform:", err);
      return;
    }

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const rollingAmplitudes: number[] = [];
    const maxBars = 45;
    let lastPushTime = 0;
    let smoothedVal = 0.12;

    const ctx = canvas.getContext("2d");

    function render(currentTime: number) {
      if (!analyser || !ctx || !canvas) return;

      analyser.getByteFrequencyData(dataArray);

      // Calculate average volume energy from frequency bins
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const rawLevel = sum / (dataArray.length * 255);

      // Smooth amplitude transitions
      smoothedVal = smoothedVal * 0.65 + rawLevel * 0.35;

      // Push new amplitude every ~50ms
      if (currentTime - lastPushTime > 50) {
        lastPushTime = currentTime;
        rollingAmplitudes.push(Math.max(0.1, Math.min(1.0, smoothedVal * 1.8)));
        if (rollingAmplitudes.length > maxBars) {
          rollingAmplitudes.shift();
        }
      }

      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = rect.width;
      const height = rect.height;

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const barWidth = 2.5;
      const barGap = 2.5;
      const totalBarSpace = barWidth + barGap;
      const visibleBarsCount = Math.floor(width / totalBarSpace);

      // Get slice of recent amplitudes to display
      const displayBars = rollingAmplitudes.slice(-visibleBarsCount);

      // Draw bars aligned to right (scrolling forward like voice notes)
      const startX = width - displayBars.length * totalBarSpace;
      const centerY = height / 2;
      const maxBarHeight = height - 6;

      ctx.fillStyle = "rgba(220, 38, 38, 0.85)"; // polished recording red

      for (let i = 0; i < displayBars.length; i++) {
        const amp = displayBars[i];
        const barHeight = Math.max(3.5, amp * maxBarHeight);
        const x = startX + i * totalBarSpace;
        const y = centerY - barHeight / 2;

        // Draw rounded rectangle bar
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }

      ctx.restore();

      animationFrameId = requestAnimationFrame(render);
    }

    animationFrameId = requestAnimationFrame(render);

    return () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
      try {
        source?.disconnect();
        analyser?.disconnect();
        if (audioContext && audioContext.state !== "closed") {
          audioContext.close();
        }
      } catch {
        // ignore
      }
    };
  }, [stream]);

  return (
    <div className="voice-live-waveform-container" aria-hidden="true">
      <canvas ref={canvasRef} className="voice-live-waveform-canvas" />
    </div>
  );
}
