"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  FileText,
  Image as ImageIcon,
  Mic,
  Paperclip,
  Send,
  Smile,
  Video,
  X,
  Image as ReplyImageIcon,
  FileText as ReplyFileIcon,
  Mic as ReplyMicIcon,
  Reply,
} from "lucide-react";
import CameraCaptureModal from "@/components/CameraCaptureModal";
import EmojiPicker from "@/components/EmojiPicker";
import VoiceRecordingWaveform from "@/components/VoiceRecordingWaveform";
import MediaPreviewModal, {
  type MediaPreviewItem,
} from "@/components/MediaPreviewModal";
import {
  apiUpdateComposerState,
  generateClientId,
  type ApiMessage,
  type ApiReplyPreview,
} from "@/lib/client/api";
import { compressImage } from "@/lib/client/compression";
import { uploadMediaDirectly } from "@/lib/client/media-upload";
import {
  ALLOWED_DOCUMENT_EXTENSIONS,
  BLOCKED_EXTENSIONS,
  MAX_DOCUMENT_SIZE_MB,
  MAX_IMAGE_SIZE_MB,
  MAX_VIDEO_SIZE_MB,
} from "@/lib/media/config";

const MESSAGE_MAX = 4000;
const MAX_RECORDING_SECONDS = 300; // 5 minutes
const TYPING_REFRESH_MS = 2_000;
const RECORDING_REFRESH_MS = 3_000;

function formatTimer(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
}

function getSupportedAudioMimeType(): string {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return "";
  }

  const candidateTypes = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/aac",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/wav",
  ];

  for (const type of candidateTypes) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }

  return "";
}

export default function MessageInput({
  conversationId,
  onSend,
  onSendVoice,
  onMediaSent,
  onError,
  replyingTo,
  onCancelReply,
}: {
  conversationId: string;
  onSend: (content: string, replyToMessageId?: string | null) => void;
  onSendVoice?: (
    audioBlob: Blob,
    durationMs: number,
    replyToMessageId?: string | null
  ) => Promise<void> | void;
  onMediaSent?: (message: ApiMessage) => void;
  onError?: (err: string) => void;
  replyingTo: ApiReplyPreview | null;
  onCancelReply: () => void;
}) {
  const [value, setValue] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isUploadingVoice, setIsUploadingVoice] = useState(false);
  const [isMaxReached, setIsMaxReached] = useState(false);

  // Media preview and upload state
  const [previewItem, setPreviewItem] = useState<MediaPreviewItem | null>(null);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const isCancelledRef = useRef<boolean>(false);
  const typingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingInactivityTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingTimeRef = useRef<number>(0);
  const lastTypingSentAtRef = useRef<number>(0);
  const recordingStatusTimerRef =
    useRef<ReturnType<typeof setInterval> | null>(null);
  const currentComposerStateRef =
    useRef<"typing" | "recording" | "idle">("idle");
  // Holds the captured blob+duration when recording auto-stops at 5 min
  const frozenBlobRef = useRef<Blob | null>(null);
  const frozenDurationMsRef = useRef<number>(0);
  // Sync ref so onstop closure can read it without stale state
  const isMaxReachedRef = useRef<boolean>(false);

  // File input refs
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);

  function resize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }

  const publishComposerState = useCallback(
    async (state: "typing" | "recording" | "idle") => {
      currentComposerStateRef.current = state;

      try {
        await apiUpdateComposerState(conversationId, state);
      } catch {
        // Composer presence must never block local messaging.
      }
    },
    [conversationId]
  );

  const stopTypingStatus = useCallback(() => {
    if (typingTimerRef.current) {
      clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
    }

    if (typingInactivityTimerRef.current) {
      clearTimeout(typingInactivityTimerRef.current);
      typingInactivityTimerRef.current = null;
    }

    lastTypingSentAtRef.current = 0;

    if (currentComposerStateRef.current === "typing") {
      void publishComposerState("idle");
    }
  }, [publishComposerState]);

  const startTypingStatus = useCallback(() => {
    if (isRecording || isUploadingVoice || isUploadingMedia) {
      return;
    }

    const now = Date.now();
    lastTypingTimeRef.current = now;

    if (
      currentComposerStateRef.current !== "typing" ||
      now - lastTypingSentAtRef.current >= 1500
    ) {
      lastTypingSentAtRef.current = now;
      void publishComposerState("typing");
    }

    if (typingInactivityTimerRef.current) {
      clearTimeout(typingInactivityTimerRef.current);
    }
    typingInactivityTimerRef.current = setTimeout(() => {
      stopTypingStatus();
    }, 3500);

    if (!typingTimerRef.current) {
      typingTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - lastTypingTimeRef.current;
        if (elapsed < 3500 && textareaRef.current?.value.trim()) {
          if (Date.now() - lastTypingSentAtRef.current >= 1500) {
            lastTypingSentAtRef.current = Date.now();
            void publishComposerState("typing");
          }
        } else {
          stopTypingStatus();
        }
      }, TYPING_REFRESH_MS);
    }
  }, [
    isRecording,
    isUploadingVoice,
    isUploadingMedia,
    publishComposerState,
    stopTypingStatus,
  ]);

  const stopRecordingStatus = useCallback(() => {
    if (recordingStatusTimerRef.current) {
      clearInterval(recordingStatusTimerRef.current);
      recordingStatusTimerRef.current = null;
    }

    if (currentComposerStateRef.current === "recording") {
      void publishComposerState("idle");
    }
  }, [publishComposerState]);

  const startRecordingStatus = useCallback(() => {
    stopTypingStatus();

    void publishComposerState("recording");

    if (recordingStatusTimerRef.current) {
      clearInterval(recordingStatusTimerRef.current);
    }

    recordingStatusTimerRef.current = setInterval(() => {
      void publishComposerState("recording");
    }, RECORDING_REFRESH_MS);
  }, [publishComposerState, stopTypingStatus]);

  function insertEmoji(emoji: string) {
    const el = textareaRef.current;
    if (!el) {
      setValue((v) => v + emoji);
      return;
    }

    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + emoji + value.slice(end);
    setValue(next);

    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
      resize();
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  }

  function handleSendText() {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MESSAGE_MAX || isUploadingVoice) return;
    stopTypingStatus();
    onSend(trimmed, replyingTo?.id ?? null);
    onCancelReply();
    setValue("");
    setShowEmoji(false);
    setShowAttachMenu(false);

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  // ==========================================
  // MEDIA ATTACHMENT SELECTION & UPLOAD
  // ==========================================

  const processImageFile = async (file: File) => {
    setShowAttachMenu(false);

    const maxBytes = MAX_IMAGE_SIZE_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      onError?.(
        `Image exceeds the maximum allowed size of ${MAX_IMAGE_SIZE_MB}MB.`
      );
      return;
    }

    try {
      const compressed = await compressImage(file);
      const previewUrl = URL.createObjectURL(compressed.file);

      setPreviewItem({
        file: compressed.file,
        category: "image",
        filename: compressed.file.name,
        mimeType: compressed.file.type,
        previewUrl,
        width: compressed.width,
        height: compressed.height,
        originalSize: compressed.originalSize,
        compressedSize: compressed.compressedSize,
      });
    } catch (err: unknown) {
      console.error("Image compression error:", err);
      onError?.("Could not process image for preview.");
    }
  };

  const processVideoFile = async (file: File) => {
    setShowAttachMenu(false);

    const maxBytes = MAX_VIDEO_SIZE_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      onError?.(
        `Video exceeds the maximum allowed size of ${MAX_VIDEO_SIZE_MB}MB.`
      );
      return;
    }

    const previewUrl = URL.createObjectURL(file);

    // Extract duration & dimensions
    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = previewUrl;

    video.onloadedmetadata = () => {
      const durationMs = Number.isFinite(video.duration)
        ? Math.round(video.duration * 1000)
        : null;
      const width = video.videoWidth || null;
      const height = video.videoHeight || null;

      setPreviewItem({
        file,
        category: "video",
        filename: file.name,
        mimeType: file.type || "video/mp4",
        previewUrl,
        width,
        height,
        durationMs,
        originalSize: file.size,
        compressedSize: file.size,
      });
    };

    video.onerror = () => {
      setPreviewItem({
        file,
        category: "video",
        filename: file.name,
        mimeType: file.type || "video/mp4",
        previewUrl,
        originalSize: file.size,
        compressedSize: file.size,
      });
    };
  };

  const handleImageFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await processImageFile(file);
  };

  const handleVideoFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await processVideoFile(file);
  };

  const handleCameraCapture = async (file: File) => {
    setShowCameraModal(false);
    const isVideo =
      file.type.startsWith("video/") ||
      /\.(mp4|mov|webm|m4v|3gp|mkv)$/i.test(file.name);

    if (isVideo) {
      await processVideoFile(file);
    } else {
      await processImageFile(file);
    }
  };

  const handleCameraFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await handleCameraCapture(file);
  };

  const handleCameraClick = () => {
    setShowAttachMenu(false);

    // In both mobile and desktop view, open the in-app camera modal if getUserMedia is supported
    if (
      typeof navigator !== "undefined" &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function"
    ) {
      setShowCameraModal(true);
    } else {
      // Graceful fallback to native device camera
      cameraInputRef.current?.click();
    }
  };

  const handleDocFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setShowAttachMenu(false);

    const ext = file.name.split(".").pop()?.toLowerCase() || "";

    if (BLOCKED_EXTENSIONS.has(ext)) {
      onError?.(`Executable files (.${ext}) are strictly blocked for security.`);
      return;
    }

    if (!ALLOWED_DOCUMENT_EXTENSIONS.has(ext)) {
      onError?.(
        `Unsupported document type (.${ext}). Allowed: ${Array.from(
          ALLOWED_DOCUMENT_EXTENSIONS
        ).join(", ")}`
      );
      return;
    }

    const maxBytes = MAX_DOCUMENT_SIZE_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      onError?.(
        `Document exceeds the maximum allowed size of ${MAX_DOCUMENT_SIZE_MB}MB.`
      );
      return;
    }

    const previewUrl = URL.createObjectURL(file);

    setPreviewItem({
      file,
      category: "document",
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      previewUrl,
      originalSize: file.size,
      compressedSize: file.size,
    });
  };

  const handleCancelMediaPreview = () => {
    if (uploadAbortControllerRef.current) {
      uploadAbortControllerRef.current.abort();
      uploadAbortControllerRef.current = null;
    }

    if (previewItem?.previewUrl) {
      URL.revokeObjectURL(previewItem.previewUrl);
    }

    setPreviewItem(null);
    setIsUploadingMedia(false);
    setUploadProgress(0);
  };

  const handleSendMediaPreview = async (caption: string) => {
    if (!previewItem || isUploadingMedia) return;

    setIsUploadingMedia(true);
    setUploadProgress(0);

    const controller = new AbortController();
    uploadAbortControllerRef.current = controller;

    const clientId = generateClientId();

    try {
      const createdMessage = await uploadMediaDirectly({
        conversationId,
        category: previewItem.category,
        file: previewItem.file,
        filename: previewItem.filename,
        mimeType: previewItem.mimeType,
        originalSize: previewItem.originalSize,
        width: previewItem.width,
        height: previewItem.height,
        durationMs: previewItem.durationMs,
        caption: caption.trim() || null,
        clientId,
        replyToMessageId: replyingTo?.id ?? null,
        onProgress: (percent) => setUploadProgress(percent),
        signal: controller.signal,
      });

      if (previewItem.previewUrl) {
        URL.revokeObjectURL(previewItem.previewUrl);
      }

      setPreviewItem(null);
      setIsUploadingMedia(false);
      setUploadProgress(0);
      uploadAbortControllerRef.current = null;

      onMediaSent?.(createdMessage);
      onCancelReply();
    } catch (err: unknown) {
      if (controller.signal.aborted) {
        return;
      }
      console.error("Direct media upload error:", err);
      const msg =
        err instanceof Error ? err.message : "Media upload failed.";
      onError?.(msg);
      setIsUploadingMedia(false);
    }
  };

  // ==========================================
  // VOICE RECORDING
  // ==========================================

  const cleanupRecording = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    recordingStartTimeRef.current = 0;
    frozenBlobRef.current = null;
    frozenDurationMsRef.current = 0;
    isMaxReachedRef.current = false;
    setIsMaxReached(false);
    setIsRecording(false);
    setRecordingSeconds(0);
  };

  const stopAndFinalizeRecording = () => {
    stopRecordingStatus();
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop();
    } else {
      cleanupRecording();
    }
  };

  const handleStartRecording = async () => {
    if (isRecording || isUploadingVoice || isUploadingMedia) return;
    setShowEmoji(false);
    setShowAttachMenu(false);

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      onError?.("Audio recording is not supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      mediaStreamRef.current = stream;
      audioChunksRef.current = [];
      isCancelledRef.current = false;

      const mimeType = getSupportedAudioMimeType();
      const options: MediaRecorderOptions = mimeType ? { mimeType } : {};
      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const streamToStop = mediaStreamRef.current;
        if (streamToStop) {
          streamToStop.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
        }

        if (isCancelledRef.current) {
          cleanupRecording();
          return;
        }

        const durationMs = Math.max(
          0,
          Date.now() - recordingStartTimeRef.current
        );
        const resolvedMime =
          recorder.mimeType || mimeType || "audio/webm";
        const finalBlob = new Blob(audioChunksRef.current, {
          type: resolvedMime,
        });

        // If stopped because 5-min max was reached, freeze blob for manual send
        if (isMaxReachedRef.current) {
          frozenBlobRef.current = finalBlob;
          frozenDurationMsRef.current = durationMs;
          return;
        }

        cleanupRecording();

        if (finalBlob.size === 0 || durationMs < 300) {
          return;
        }

        if (onSendVoice) {
          try {
            setIsUploadingVoice(true);
            await onSendVoice(
              finalBlob,
              durationMs,
              replyingTo?.id ?? null
            );
            onCancelReply();
          } catch (uploadErr) {
            console.error("Voice sending failed:", uploadErr);
          } finally {
            setIsUploadingVoice(false);
          }
        }
      };

      recorder.start(100);
      recordingStartTimeRef.current = Date.now();
      setIsRecording(true);
      setRecordingSeconds(0);
      startRecordingStatus();

      const timer = setInterval(() => {
        setRecordingSeconds((prev) => {
          const next = prev + 1;
          if (next >= MAX_RECORDING_SECONDS) {
            isMaxReachedRef.current = true;
            setIsMaxReached(true);
            stopRecordingStatus();
            setTimeout(() => {
              const rec = mediaRecorderRef.current;
              if (rec && rec.state !== "inactive") {
                rec.stop();
              }
              if (recordingTimerRef.current) {
                clearInterval(recordingTimerRef.current);
                recordingTimerRef.current = null;
              }
            }, 0);
            return MAX_RECORDING_SECONDS;
          }
          return next;
        });
      }, 1000);

      recordingTimerRef.current = timer;
    } catch (err: unknown) {
      console.error("Microphone access error:", err);
      cleanupRecording();
      onError?.(
        "Could not access microphone. Please check permissions."
      );
    }
  };

  const handleCancelRecording = () => {
    isCancelledRef.current = true;
    isMaxReachedRef.current = false;
    stopRecordingStatus();
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    } else {
      cleanupRecording();
    }
  };

  const handleSendVoiceRecording = async () => {
    if (isUploadingVoice) return;

    if (isMaxReached && frozenBlobRef.current) {
      const blob = frozenBlobRef.current;
      const durationMs = frozenDurationMsRef.current;
      cleanupRecording();
      stopRecordingStatus();
      if (onSendVoice) {
        try {
          setIsUploadingVoice(true);
          await onSendVoice(
            blob,
            durationMs,
            replyingTo?.id ?? null
          );
          onCancelReply();
        } catch (uploadErr) {
          console.error("Voice sending failed:", uploadErr);
        } finally {
          setIsUploadingVoice(false);
        }
      }
      return;
    }

    if (!isRecording) return;
    isCancelledRef.current = false;
    stopAndFinalizeRecording();
  };

  useEffect(() => {
    return () => {
      if (typingTimerRef.current) {
        clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
      }

      if (typingInactivityTimerRef.current) {
        clearTimeout(typingInactivityTimerRef.current);
        typingInactivityTimerRef.current = null;
      }

      if (recordingStatusTimerRef.current) {
        clearInterval(recordingStatusTimerRef.current);
        recordingStatusTimerRef.current = null;
      }

      if (currentComposerStateRef.current !== "idle") {
        void apiUpdateComposerState(conversationId, "idle");
      }

      if (previewItem?.previewUrl) {
        URL.revokeObjectURL(previewItem.previewUrl);
      }
    };
  }, [conversationId, previewItem]);

  const overLimit = value.length > MESSAGE_MAX;
  const hasText = value.trim().length > 0;

  return (
    <div className="composer" role="region" aria-label="Message composer">
      {/* Hidden file pickers for mobile & desktop */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={handleCameraFileChange}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleImageFileChange}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        style={{ display: "none" }}
        onChange={handleVideoFileChange}
      />
      <input
        ref={docInputRef}
        type="file"
        accept=".pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.csv,.rtf"
        style={{ display: "none" }}
        onChange={handleDocFileChange}
      />

      {/* Media Preview Modal */}
      {previewItem && (
        <MediaPreviewModal
          item={previewItem}
          isUploading={isUploadingMedia}
          uploadProgress={uploadProgress}
          onSend={handleSendMediaPreview}
          onCancel={handleCancelMediaPreview}
        />
      )}

      {/* Desktop Camera Capture Modal */}
      {showCameraModal && (
        <CameraCaptureModal
          onCapture={handleCameraCapture}
          onClose={() => setShowCameraModal(false)}
          onFallbackToFilePicker={() => cameraInputRef.current?.click()}
          onError={(err) => onError?.(err)}
        />
      )}

      {replyingTo && (
        <div className="composer-reply-preview">
          <div className="composer-reply-accent" aria-hidden="true">
            <Reply size={16} strokeWidth={2} />
          </div>
          <div className="composer-reply-copy">
            <strong>Replying to {replyingTo.senderUsername}</strong>
            <span>
              {replyingTo.type === "image" ? (
                <ReplyImageIcon size={14} aria-hidden="true" />
              ) : replyingTo.type === "video" ? (
                <Video size={14} aria-hidden="true" />
              ) : replyingTo.type === "document" ||
                replyingTo.type === "file" ? (
                <ReplyFileIcon size={14} aria-hidden="true" />
              ) : replyingTo.type === "voice" ? (
                <ReplyMicIcon size={14} aria-hidden="true" />
              ) : null}
              <span>{replyingTo.preview}</span>
            </span>
          </div>
          <button
            type="button"
            className="composer-reply-cancel"
            aria-label="Cancel reply"
            title="Cancel reply"
            onClick={onCancelReply}
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>
      )}

      <div className="composer-controls">
      {isRecording ? (
        <div className="voice-recording-bar">
          <button
            type="button"
            className="voice-cancel-btn"
            aria-label="Cancel recording"
            title="Cancel recording"
            onClick={handleCancelRecording}
          >
            <X size={18} strokeWidth={2} />
          </button>

          <div className="voice-recording-status">
            <span
              className={`voice-rec-dot${isMaxReached ? " paused" : ""}`}
              aria-hidden="true"
            />
            <VoiceRecordingWaveform
              stream={isMaxReached ? null : mediaStreamRef.current}
            />
            <span
              className={`voice-recording-timer${
                isMaxReached ? " voice-max-reached" : ""
              }`}
              aria-live="polite"
              aria-label={
                isMaxReached
                  ? "Maximum recording length reached: 5 minutes"
                  : `Recording duration: ${formatTimer(recordingSeconds)}`
              }
            >
              {isMaxReached ? "5:00 · Max" : formatTimer(recordingSeconds)}
            </span>
          </div>

          <button
            type="button"
            className="send-btn voice-send-btn"
            aria-label="Send voice message"
            title="Send voice message"
            disabled={
              isUploadingVoice || (!isMaxReached && recordingSeconds < 1)
            }
            onClick={handleSendVoiceRecording}
          >
            <Send size={18} strokeWidth={2} />
          </button>
        </div>
      ) : (
        <>
          {/* Attachment button & popover */}
          <div className="attach-wrap">
            {showAttachMenu && (
              <div
                className="attach-menu-popover"
                role="menu"
                aria-label="Attachment options"
              >
                <button
                  type="button"
                  className="attach-menu-item"
                  role="menuitem"
                  onClick={handleCameraClick}
                >
                  <span className="attach-menu-icon">
                    <Camera size={18} strokeWidth={2} />
                  </span>
                  <span>Camera</span>
                </button>
                <button
                  type="button"
                  className="attach-menu-item"
                  role="menuitem"
                  onClick={() => {
                    imageInputRef.current?.click();
                  }}
                >
                  <span className="attach-menu-icon">
                    <ImageIcon size={18} strokeWidth={2} />
                  </span>
                  <span>Photos</span>
                </button>
                <button
                  type="button"
                  className="attach-menu-item"
                  role="menuitem"
                  onClick={() => {
                    videoInputRef.current?.click();
                  }}
                >
                  <span className="attach-menu-icon">
                    <Video size={18} strokeWidth={2} />
                  </span>
                  <span>Video</span>
                </button>
                <button
                  type="button"
                  className="attach-menu-item"
                  role="menuitem"
                  onClick={() => {
                    docInputRef.current?.click();
                  }}
                >
                  <span className="attach-menu-icon">
                    <FileText size={18} strokeWidth={2} />
                  </span>
                  <span>Document</span>
                </button>
              </div>
            )}

            <button
              type="button"
              className="attach-btn"
              aria-label="Attach file"
              title="Attach media"
              disabled={isUploadingVoice || isUploadingMedia}
              onClick={() => {
                setShowAttachMenu((v) => !v);
                setShowEmoji(false);
              }}
            >
              <Paperclip size={20} strokeWidth={2} />
            </button>
          </div>

          <div className="composer-wrap" style={{ flex: "1 1 auto" }}>
            {showEmoji && (
              <EmojiPicker
                onSelect={insertEmoji}
                onClose={() => setShowEmoji(false)}
              />
            )}
            <textarea
              ref={textareaRef}
              value={value}
              disabled={isUploadingVoice || isUploadingMedia}
              onChange={(e) => {
                const nextValue = e.target.value;
                setValue(nextValue);
                if (nextValue.trim()) {
                  startTypingStatus();
                } else {
                  stopTypingStatus();
                }
                resize();
              }}
              onKeyDown={handleKeyDown}
              placeholder={
                isUploadingVoice
                  ? "Sending voice message…"
                  : isUploadingMedia
                  ? "Uploading media…"
                  : "Type a message…"
              }
              rows={1}
              maxLength={MESSAGE_MAX + 200}
              aria-label="Message"
              enterKeyHint="send"
            />
            {overLimit && (
              <div className="status-line failed">
                Message is too long ({value.length}/{MESSAGE_MAX}).
              </div>
            )}
          </div>

          <button
            type="button"
            className="emoji-btn"
            aria-label="Emoji"
            title="Insert emoji"
            disabled={isUploadingVoice || isUploadingMedia}
            onClick={() => {
              setShowEmoji((v) => !v);
              setShowAttachMenu(false);
            }}
          >
            <Smile size={20} strokeWidth={2} />
          </button>

          {hasText ? (
            <button
              type="button"
              className="send-btn"
              aria-label="Send message"
              title="Send message"
              disabled={
                !hasText || overLimit || isUploadingVoice || isUploadingMedia
              }
              onClick={handleSendText}
            >
              <Send size={18} strokeWidth={2} />
            </button>
          ) : (
            <button
              type="button"
              className="mic-btn"
              aria-label="Start voice recording"
              title="Record voice message"
              disabled={isUploadingVoice || isUploadingMedia}
              onClick={handleStartRecording}
            >
              <Mic size={20} strokeWidth={2} />
            </button>
          )}
        </>
      )}
      </div>
    </div>
  );
}
