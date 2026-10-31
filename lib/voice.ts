export const MAX_VOICE_DURATION_MS = 300_000; // 5 minutes
export const MIN_VOICE_DURATION_MS = 100; // 100 milliseconds
export const MAX_VOICE_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
export const MIN_VOICE_FILE_SIZE = 64; // 64 bytes

const ALLOWED_MIME_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/aac",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/x-m4a",
  "audio/m4a",
]);

/**
 * Clean and normalize MIME type strings (e.g. "audio/webm;codecs=opus" -> "audio/webm")
 */
export function normalizeMimeType(rawMime: string): string {
  return rawMime.split(";")[0].trim().toLowerCase();
}

/**
 * Inspect magic bytes of audio buffer to verify file integrity.
 */
export function validateAudioMagicBytes(buffer: Buffer): {
  valid: boolean;
  detectedExt: string;
} {
  if (buffer.length < 4) {
    return { valid: false, detectedExt: "" };
  }

  // WebM / Matroska: 0x1A 0x45 0xDF 0xA3 (EBML Header)
  if (
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return { valid: true, detectedExt: "webm" };
  }

  // Ogg container: "OggS" (0x4F 0x67 0x67 0x53)
  if (
    buffer[0] === 0x4f &&
    buffer[1] === 0x67 &&
    buffer[2] === 0x67 &&
    buffer[3] === 0x53
  ) {
    return { valid: true, detectedExt: "ogg" };
  }

  // RIFF WAV: "RIFF" .... "WAVE"
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer.length >= 12
  ) {
    const waveTag = buffer.subarray(8, 12).toString("ascii");
    if (waveTag === "WAVE") {
      return { valid: true, detectedExt: "wav" };
    }
  }

  // MP4 / M4A: starts with ftyp or 0x00 0x00 0x00
  if (buffer.length >= 8) {
    const ftyp = buffer.subarray(4, 8).toString("ascii");
    if (ftyp === "ftyp" || ftyp === "moov" || ftyp === "mdat") {
      return { valid: true, detectedExt: "m4a" };
    }
  }

  // MP3: ID3 header "ID3"
  if (
    buffer[0] === 0x49 &&
    buffer[1] === 0x44 &&
    buffer[2] === 0x33
  ) {
    return { valid: true, detectedExt: "mp3" };
  }

  // MP3: MPEG sync frame header (0xFF 0xFB, 0xFF 0xF3, 0xFF 0xF2, 0xFF 0xE3)
  if (
    buffer[0] === 0xff &&
    (buffer[1] & 0xe0) === 0xe0
  ) {
    return { valid: true, detectedExt: "mp3" };
  }

  // AAC ADTS: 0xFF 0xF1 or 0xFF 0xF9
  if (
    buffer[0] === 0xff &&
    (buffer[1] === 0xf1 || buffer[1] === 0xf9)
  ) {
    return { valid: true, detectedExt: "aac" };
  }

  return { valid: false, detectedExt: "" };
}

export function validateVoiceUpload(params: {
  buffer: Buffer;
  mimeType: string;
  durationMs: number;
}): { valid: boolean; error?: string; extension?: string } {
  const { buffer, mimeType, durationMs } = params;

  if (buffer.byteLength < MIN_VOICE_FILE_SIZE) {
    return { valid: false, error: "Audio file is too small or empty." };
  }

  if (buffer.byteLength > MAX_VOICE_FILE_SIZE) {
    return { valid: false, error: "Audio file exceeds maximum size limit of 10MB." };
  }

  if (
    !Number.isFinite(durationMs) ||
    durationMs < MIN_VOICE_DURATION_MS ||
    durationMs > MAX_VOICE_DURATION_MS
  ) {
    return {
      valid: false,
      error: "Audio duration must be between 100ms and 5 minutes.",
    };
  }

  const baseMime = normalizeMimeType(mimeType);
  if (!ALLOWED_MIME_TYPES.has(baseMime)) {
    return { valid: false, error: "Unsupported audio format." };
  }

  const magic = validateAudioMagicBytes(buffer);
  if (!magic.valid) {
    return { valid: false, error: "Invalid audio file content." };
  }

  return {
    valid: true,
    extension: magic.detectedExt,
  };
}
