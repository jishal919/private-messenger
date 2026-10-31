/**
 * Audio peak extraction and caching for voice message waveforms.
 */

const waveformCache = new Map<string, number[]>();

export const DEFAULT_BAR_COUNT = 38;

/**
 * Generate a deterministic pseudo-random waveform based on a string seed (e.g. mediaKey or messageId)
 * used as an immediate fallback before full audio decoding completes.
 */
export function generateDeterministicWaveform(
  seed: string,
  barCount: number = DEFAULT_BAR_COUNT
): number[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }

  const bars: number[] = [];
  let prev = 0.35;

  for (let i = 0; i < barCount; i++) {
    // Deterministic pseudo-random number generator using seed hash
    const x = Math.sin((hash + i * 9301 + 49297) % 233280) * 10000;
    const rand = x - Math.floor(x);

    // Natural voice pattern shape (bell-like curve with speech variations)
    const envelope = Math.sin((i / (barCount - 1)) * Math.PI);
    const target = 0.2 + 0.65 * rand * (0.4 + 0.6 * envelope);
    const smoothed = prev * 0.4 + target * 0.6;
    prev = smoothed;

    bars.push(Math.max(0.12, Math.min(1.0, smoothed)));
  }

  return bars;
}

/**
 * Extract normalized peaks (0.0 to 1.0) from an AudioBuffer.
 */
export function extractPeaksFromAudioBuffer(
  audioBuffer: AudioBuffer,
  barCount: number = DEFAULT_BAR_COUNT
): number[] {
  const channelData = audioBuffer.getChannelData(0);
  const totalSamples = channelData.length;
  const blockSize = Math.floor(totalSamples / barCount);

  if (blockSize <= 0) {
    return new Array(barCount).fill(0.3);
  }

  const rawPeaks: number[] = [];
  let maxPeak = 0;

  for (let i = 0; i < barCount; i++) {
    const start = i * blockSize;
    const end = Math.min(start + blockSize, totalSamples);
    let peak = 0;

    // Sample across the block with stride for performance
    const step = Math.max(1, Math.floor((end - start) / 50));
    for (let j = start; j < end; j += step) {
      const val = Math.abs(channelData[j]);
      if (val > peak) {
        peak = val;
      }
    }

    rawPeaks.push(peak);
    if (peak > maxPeak) {
      maxPeak = peak;
    }
  }

  // Normalize peaks so highest is around 0.95 and quiet parts have at least 0.12 height
  const scale = maxPeak > 0 ? 0.9 / maxPeak : 1;
  return rawPeaks.map((p) => Math.max(0.12, Math.min(1.0, p * scale)));
}

/**
 * Fetch and decode audio to generate real waveform peaks.
 * Caches results in memory for instant subsequent renders.
 */
export async function getAudioWaveformPeaks(
  audioUrl: string,
  cacheKey: string,
  barCount: number = DEFAULT_BAR_COUNT
): Promise<number[]> {
  const cached = waveformCache.get(cacheKey);
  if (cached && cached.length === barCount) {
    return cached;
  }

  try {
    const response = await fetch(audioUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch audio: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();

    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextClass) {
      const fallback = generateDeterministicWaveform(cacheKey, barCount);
      waveformCache.set(cacheKey, fallback);
      return fallback;
    }

    const audioContext = new AudioContextClass();
    try {
      const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const peaks = extractPeaksFromAudioBuffer(decodedBuffer, barCount);
      waveformCache.set(cacheKey, peaks);
      return peaks;
    } finally {
      try {
        await audioContext.close();
      } catch {
        // ignore
      }
    }
  } catch (err) {
    console.warn("Waveform extraction failed, using deterministic fallback:", err);
    const fallback = generateDeterministicWaveform(cacheKey, barCount);
    waveformCache.set(cacheKey, fallback);
    return fallback;
  }
}
