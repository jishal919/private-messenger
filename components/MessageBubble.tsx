"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiMessage } from "@/lib/client/api";
import { getMediaUrl } from "@/lib/client/api";
import {
  registerPlayingAudio,
  unregisterPlayingAudio,
} from "@/lib/client/audio-player";
import VoiceWaveform from "@/components/VoiceWaveform";
import MediaLightbox from "@/components/MediaLightbox";
import { formatClockTime } from "@/lib/format-time";
import {
  Check,
  CheckCheck,
  CircleSlash,
  ChevronDown,
  CornerUpRight,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic as MicIcon,
  Pause,
  Play,
  Reply,
  Video,
} from "lucide-react";

type LocalMessage = ApiMessage & {
  status: "sent" | "sending" | "failed";
  clientId?: string | null;
};

function formatTime(ts: number): string {
  return formatClockTime(ts, {
    locale: "en-US",
    timeZone: "Asia/Kolkata",
  });
}

function formatDurationSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function VoicePlayer({
  mediaKey,
  durationMs,
  conversationId,
  isOwn,
  isPending,
}: {
  mediaKey: string | null;
  durationMs: number | null;
  conversationId: string;
  isOwn: boolean;
  isPending: boolean;
}) {
  const initialDuration = durationMs && durationMs > 0 ? durationMs / 1000 : 0;
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(initialDuration);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handlePause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setIsPlaying(false);
  }, []);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      unregisterPlayingAudio(handlePause);
    };
  }, [handlePause]);

  const togglePlayPause = async () => {
    if (isPending || !mediaKey) return;

    if (isPlaying) {
      handlePause();
      return;
    }

    setHasError(false);

    let audio = audioRef.current;
    if (!audio) {
      const srcUrl = getMediaUrl(conversationId, mediaKey);
      audio = new Audio(srcUrl);
      audioRef.current = audio;

      audio.addEventListener("timeupdate", () => {
        if (audio) {
          setCurrentTime(audio.currentTime);
        }
      });

      audio.addEventListener("loadedmetadata", () => {
        if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
          setTotalDuration(audio.duration);
        }
      });

      audio.addEventListener("durationchange", () => {
        if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
          setTotalDuration(audio.duration);
        }
      });

      audio.addEventListener("waiting", () => {
        setIsLoading(true);
      });

      audio.addEventListener("playing", () => {
        setIsLoading(false);
        setIsPlaying(true);
      });

      audio.addEventListener("ended", () => {
        setIsPlaying(false);
        setCurrentTime(0);
        if (audio) {
          audio.currentTime = 0;
        }
        unregisterPlayingAudio(handlePause);
      });

      audio.addEventListener("error", (e) => {
        console.error("Audio playback error:", e);
        setIsLoading(false);
        setIsPlaying(false);
        setHasError(true);
        unregisterPlayingAudio(handlePause);
      });
    }

    registerPlayingAudio(handlePause);

    try {
      setIsLoading(true);
      await audio.play();
      setIsPlaying(true);
      setIsLoading(false);
    } catch (err) {
      console.warn("Audio play prevented/failed:", err);
      setIsPlaying(false);
      setIsLoading(false);
      setHasError(true);
    }
  };

  const handleSeek = (ratio: number) => {
    if (totalDuration <= 0) return;
    const nextTime = Math.max(0, Math.min(totalDuration, ratio * totalDuration));
    setCurrentTime(nextTime);

    if (audioRef.current && Number.isFinite(nextTime)) {
      audioRef.current.currentTime = nextTime;
    }
  };

  const progress =
    totalDuration > 0
      ? Math.min(1, Math.max(0, currentTime / totalDuration))
      : 0;

  const audioUrl = mediaKey ? getMediaUrl(conversationId, mediaKey) : "";
  const cacheKey = mediaKey || "voice-preview";

  return (
    <div className={`voice-player ${isOwn ? "out" : "in"}`}>
      <button
        type="button"
        className="voice-play-btn"
        disabled={isPending || hasError}
        aria-label={isPlaying ? "Pause voice message" : "Play voice message"}
        title={isPlaying ? "Pause" : "Play"}
        onClick={togglePlayPause}
      >
        {isLoading ? (
          <span className="voice-spinner" aria-hidden="true">
            <Loader2 size={18} strokeWidth={2} className="spin" />
          </span>
        ) : isPlaying ? (
          <span className="voice-icon" aria-hidden="true">
            <Pause size={18} strokeWidth={2} />
          </span>
        ) : (
          <span className="voice-icon" aria-hidden="true">
            <Play size={18} strokeWidth={2} style={{ marginLeft: 2 }} />
          </span>
        )}
      </button>

      <VoiceWaveform
        audioUrl={audioUrl}
        cacheKey={cacheKey}
        durationMs={durationMs}
        progress={progress}
        isOwn={isOwn}
        isPlaying={isPlaying}
        disabled={isPending || hasError}
        onSeek={handleSeek}
      />

      <div className="voice-duration">
        {hasError ? (
          <span className="voice-error-text">Unavailable</span>
        ) : (
          formatDurationSeconds(
            isPlaying || currentTime > 0 ? currentTime : totalDuration
          )
        )}
      </div>
    </div>
  );
}

function ImageBubble({
  mediaKey,
  mediaName,
  caption,
  conversationId,
  isExpired,
  captionText,
}: {
  mediaKey: string | null;
  mediaName?: string | null;
  caption: string | null;
  conversationId: string;
  isExpired: boolean;
  captionText?: string | null;
}) {
  const [showLightbox, setShowLightbox] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageAspectRatio, setImageAspectRatio] = useState(4 / 3);

  if (isExpired || !mediaKey) {
    const isUnavailable = !mediaKey;
    return (
      <div className="media-expired-card">
        <span className="media-expired-icon" aria-hidden="true">
          <ImageIcon size={24} strokeWidth={2} />
        </span>
        <span className="media-expired-label">
          {isUnavailable
            ? "This media is no longer available. Please ask the sender to send it again."
            : "Image expired"}
        </span>
        {captionText && <div className="message-content">{captionText}</div>}
      </div>
    );
  }

  const mediaUrl = getMediaUrl(conversationId, mediaKey);

  return (
    <div className="media-image-bubble">
      <div
        className={`media-image-container${!imageLoaded ? " loading" : ""}`}
        style={{ aspectRatio: imageAspectRatio }}
        onClick={() => {
          if (imageLoaded) setShowLightbox(true);
        }}
        role="button"
        tabIndex={0}
        aria-label={imageLoaded ? "Enlarge photo" : "Image loading"}
        onKeyDown={(e) => {
          if (imageLoaded && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setShowLightbox(true);
          }
        }}
      >
        {(!imageLoaded || imageFailed) && (
          <div className="media-image-placeholder" role="status">
            {!imageFailed && (
              <Loader2 size={24} strokeWidth={2} className="spin" aria-hidden="true" />
            )}
            <span>{imageFailed ? "Image unavailable" : "Loading image"}</span>
          </div>
        )}
        {!imageFailed && (
          <img
            src={mediaUrl}
            alt={caption || "Photo"}
            className={`media-image-element${imageLoaded ? " loaded" : ""}`}
            loading="lazy"
            onLoad={(event) => {
              const image = event.currentTarget;
              setImageAspectRatio(image.naturalWidth / image.naturalHeight);
              setImageLoaded(true);
            }}
            onError={() => setImageFailed(true)}
          />
        )}
      </div>

      {caption && <div className="media-caption">{caption}</div>}

      {showLightbox && (
        <MediaLightbox
          src={mediaUrl}
          alt={caption || "Photo"}
          filename={mediaName || caption || "photo.jpg"}
          onClose={() => setShowLightbox(false)}
        />
      )}
    </div>
  );
}

function VideoBubble({
  mediaKey,
  caption,
  conversationId,
  isExpired,
  captionText,
}: {
  mediaKey: string | null;
  caption: string | null;
  conversationId: string;
  isExpired: boolean;
  captionText?: string | null;
}) {
  if (isExpired || !mediaKey) {
    const isUnavailable = !mediaKey;
    return (
      <div className="media-expired-card">
        <span className="media-expired-icon" aria-hidden="true">
          <Video size={24} strokeWidth={2} />
        </span>
        <span className="media-expired-label">
          {isUnavailable
            ? "This media is no longer available. Please ask the sender to send it again."
            : "Video expired"}
        </span>
        {captionText && <div className="message-content">{captionText}</div>}
      </div>
    );
  }

  const mediaUrl = getMediaUrl(conversationId, mediaKey);

  return (
    <div className="media-video-bubble">
      <div className="media-video-container">
        <video
          src={mediaUrl}
          controls
          playsInline
          preload="metadata"
          className="media-video-element"
        />
      </div>
      {caption && <div className="media-caption">{caption}</div>}
    </div>
  );
}

function DocumentBubble({
  mediaKey,
  mediaName,
  mediaSize,
  caption,
  conversationId,
  isExpired,
  captionText,
}: {
  mediaKey: string | null;
  mediaName: string | null;
  mediaSize: number | null;
  caption: string | null;
  conversationId: string;
  isExpired: boolean;
  captionText?: string | null;
}) {
  if (isExpired || !mediaKey) {
    const isUnavailable = !mediaKey;
    return (
      <div className="media-expired-card">
        <span className="media-expired-icon" aria-hidden="true">
          <FileText size={24} strokeWidth={2} />
        </span>
        <span className="media-expired-label">
          {isUnavailable
            ? "This media is no longer available. Please ask the sender to send it again."
            : "Document expired"}
        </span>
        {captionText && <div className="message-content">{captionText}</div>}
      </div>
    );
  }

  const mediaUrl = getMediaUrl(conversationId, mediaKey);
  const displayName = mediaName || "Document";
  const ext = displayName.split(".").pop()?.toUpperCase() || "DOC";

  return (
    <div className="media-document-bubble">
      <a
        href={mediaUrl}
        target="_blank"
        rel="noopener noreferrer"
        download={displayName}
        className="media-document-card"
      >
        <div className="media-document-icon-badge">
          <span className="media-doc-badge-ext">{ext}</span>
          <span className="media-doc-badge-icon" aria-hidden="true">
            <FileText size={18} strokeWidth={2} />
          </span>
        </div>
        <div className="media-document-info">
          <div className="media-document-name" title={displayName}>
            {displayName}
          </div>
          <div className="media-document-meta">
            {formatBytes(mediaSize)} · Tap to download
          </div>
        </div>
      </a>
      {caption && <div className="media-caption">{caption}</div>}
    </div>
  );
}

export default function MessageBubble({
  message,
  conversationId,
  isOwn,
  isSelected = false,
  isSelectionMode = false,
  onToggleSelect,
  onLongPress,
  onOpenMenu,
  onRetry,
  onReply,
  onForward,
  onJumpToReply,
  senderUsername,
}: {
  message: LocalMessage;
  conversationId?: string;
  isOwn: boolean;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  onToggleSelect?: (messageId: string) => void;
  onLongPress?: (
    message: LocalMessage,
    pos: { x: number; y: number; rect: DOMRect }
  ) => void;
  onOpenMenu?: (
    message: LocalMessage,
    pos: { x: number; y: number; rect?: DOMRect }
  ) => void;
  onRetry: () => void;
  onReply: () => void;
  onForward: () => void;
  onJumpToReply: (messageId: string) => void;
  senderUsername: string;
}) {
  const convId = conversationId || "";
  const isVoice = message.type === "voice";
  const isImage = message.type === "image";
  const isVideo = message.type === "video";
  const isDocument = message.type === "document" || message.type === "file";

  const isExpired = Boolean(
    message.mediaExpiresAt && message.mediaExpiresAt <= Date.now()
  );
  const canReply = message.status === "sent" && !message.deletedForEveryone;
  const bubbleWrapperRef = useRef<HTMLDivElement>(null);
  const [dragX, setDragX] = useState(0);
  const dragRef = useRef<{ x: number; y: number; pointerId: number; active: boolean; horizontal: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartPosRef.current = null;
  };

  useEffect(() => {
    return () => {
      clearLongPress();
    };
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") {
      return;
    }

    if (isSelectionMode) {
      return;
    }

    const target = event.target as HTMLElement;
    const isInteractive = Boolean(
      target.closest("button,a,input,textarea,video,audio,.voice-waveform-wrap,.message-reply-quote")
    );

    if (canReply && !isInteractive) {
      dragRef.current = {
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId,
        active: false,
        horizontal: false,
      };
    }

    touchStartPosRef.current = { x: event.clientX, y: event.clientY };
    const rowEl = event.currentTarget;

    clearLongPress();
    longPressTimerRef.current = setTimeout(() => {
      clearLongPress();
      suppressClickRef.current = true;
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 350);

      if (typeof window !== "undefined") {
        window.getSelection()?.removeAllRanges();
      }

      const bubbleEl = rowEl.querySelector(".bubble") as HTMLElement | null;
      const rect = bubbleEl?.getBoundingClientRect() ?? rowEl.getBoundingClientRect();
      onLongPress?.(message, { x: event.clientX, y: event.clientY, rect });
    }, 450);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (touchStartPosRef.current) {
      const dx = event.clientX - touchStartPosRef.current.x;
      const dy = event.clientY - touchStartPosRef.current.y;
      if (Math.hypot(dx, dy) > 8) {
        clearLongPress();
      }
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.active) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) >= Math.abs(dx) || dx <= 0) {
        dragRef.current = null;
        return;
      }
      drag.active = true;
      drag.horizontal = true;
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }
    if (drag.horizontal) {
      event.preventDefault();
      setDragX(Math.min(64, Math.max(0, dx)));
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    clearLongPress();
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag?.horizontal || drag.pointerId !== event.pointerId) return;
    if (event.clientX - drag.x >= 52) {
      onReply();
      suppressClickRef.current = true;
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 250);
    }
    setDragX(0);
  };

  const onPointerCancel = () => {
    clearLongPress();
    dragRef.current = null;
    setDragX(0);
  };

  return (
    <div
      className={
        "bubble-row " +
        (isOwn ? "out" : "in") +
        (isSelected ? " is-selected" : "") +
        (isSelectionMode ? " selection-mode" : "")
      }
      data-selected={isSelected ? "true" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={(event) => {
        if (suppressClickRef.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressClickRef.current = false;
          return;
        }
        if (isSelectionMode && onToggleSelect) {
          event.preventDefault();
          event.stopPropagation();
          onToggleSelect(message.id);
        }
      }}
      onDoubleClick={(event) => {
        if (event.target === event.currentTarget && canReply && !isSelectionMode) {
          onReply();
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const nativeEvent = event.nativeEvent as unknown as { pointerType?: string };
        if (nativeEvent?.pointerType === "touch" || suppressClickRef.current) {
          return;
        }
        if (isSelectionMode) {
          return;
        }
        onOpenMenu?.(message, { x: event.clientX, y: event.clientY });
      }}
    >
      {isSelectionMode && (
        <span
          className={"message-select-indicator" + (isSelected ? " checked" : "")}
          aria-hidden="true"
        >
          {isSelected && <Check size={12} strokeWidth={3} />}
        </span>
      )}
      <span className="reply-swipe-indicator" style={{ opacity: dragX / 52, transform: `scale(${0.7 + Math.min(dragX / 52, 1) * 0.3})` }} aria-hidden="true">
        <Reply size={18} />
      </span>
      <div ref={bubbleWrapperRef} className={"bubble-wrapper " + (isOwn ? "out" : "in")} style={{ transform: dragX > 0 ? `translateX(${dragX}px)` : undefined, transition: dragRef.current?.active ? "none" : "transform 180ms ease-out" }}>
        <div
          className={
            "bubble " +
            (isOwn ? "out" : "in") +
            (message.deletedForEveryone ? " deleted-bubble" : "") +
            (!message.deletedForEveryone && isVoice ? " voice-bubble" : "") +
            (!message.deletedForEveryone && isImage ? " media-bubble image-bubble" : "") +
            (!message.deletedForEveryone && isVideo ? " media-bubble video-bubble" : "") +
            (!message.deletedForEveryone && isDocument ? " media-bubble document-bubble" : "")
          }
          onClickCapture={(event) => {
            if (suppressClickRef.current) {
              event.preventDefault();
              event.stopPropagation();
              suppressClickRef.current = false;
              return;
            }
            if (isSelectionMode && onToggleSelect) {
              event.preventDefault();
              event.stopPropagation();
              onToggleSelect(message.id);
            }
          }}

        >
          <button
            type="button"
            className="message-chevron-btn"
            aria-label="Message options"
            title="Message options"
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              onOpenMenu?.(message, { x: rect.left, y: rect.bottom, rect });
            }}
          >
            <ChevronDown size={14} strokeWidth={2.2} />
          </button>

          {message.deletedForEveryone ? (
            <div className="deleted-message-content">
              <CircleSlash size={14} className="deleted-message-icon" aria-hidden="true" />
              <span className="deleted-message-text">
                {isOwn ? "You deleted this message" : "This message was deleted"}
              </span>
            </div>
          ) : (
            <>
              {message.isForwarded && (
                <div className="message-forwarded-tag" aria-label="Forwarded message">
                  <CornerUpRight size={12} strokeWidth={2.4} aria-hidden="true" />
                  <span>Forwarded</span>
                </div>
              )}

              {message.replyTo && (
                <button
                  type="button"
                  className="message-reply-quote"
                  disabled={message.replyTo.available === false}
                  onClick={() => onJumpToReply(message.replyTo!.id)}
                  aria-label={`Jump to message from ${message.replyTo.senderUsername}: ${message.replyTo.preview}`}
                >
                  <span className="message-reply-accent" aria-hidden="true" />
                  <span className="message-reply-copy">
                    <strong>{message.replyTo.senderUsername}</strong>
                    <span className="message-reply-preview">
                      {message.replyTo.type === "image" ? <ImageIcon size={13} />
                        : message.replyTo.type === "video" ? <Video size={13} />
                        : message.replyTo.type === "document" || message.replyTo.type === "file" ? <FileText size={13} />
                        : message.replyTo.type === "voice" ? <MicIcon size={13} /> : null}
                      <span>{message.replyTo.preview}</span>
                    </span>
                  </span>
                </button>
              )}

              {isVoice ? (
                <VoicePlayer
                  mediaKey={message.mediaKey}
                  durationMs={message.durationMs}
                  conversationId={convId}
                  isOwn={isOwn}
                  isPending={message.status === "sending"}
                />
              ) : isImage ? (
                <ImageBubble
                  mediaKey={message.mediaKey}
                  mediaName={message.mediaName ?? null}
                  caption={message.content}
                  conversationId={convId}
                  isExpired={isExpired}
                  captionText={message.content}
                />
              ) : isVideo ? (
                <VideoBubble
                  mediaKey={message.mediaKey}
                  caption={message.content}
                  conversationId={convId}
                  isExpired={isExpired}
                  captionText={message.content}
                />
              ) : isDocument ? (
                <DocumentBubble
                  mediaKey={message.mediaKey}
                  mediaName={message.mediaName ?? null}
                  mediaSize={message.mediaSize ?? null}
                  caption={message.content}
                  conversationId={convId}
                  isExpired={isExpired}
                  captionText={message.content}
                />
              ) : (
                <div className="message-content">{message.content ?? ""}</div>
              )}
            </>
          )}

          <div className="meta-row">
            <span>{formatTime(message.createdAt)}</span>

            {isOwn && !message.deletedForEveryone && message.status === "sending" && (
              <span>· Sending…</span>
            )}

            {isOwn && !message.deletedForEveryone && message.status === "sent" && (
              <span
                className={
                  "message-checks " +
                  (message.receiptStatus === "read"
                    ? "read"
                    : message.receiptStatus === "delivered"
                    ? "delivered"
                    : "sent")
                }
                aria-label={
                  message.receiptStatus === "read"
                    ? "Read"
                    : message.receiptStatus === "delivered"
                    ? "Delivered"
                    : "Sent"
                }
              >
                {message.receiptStatus === "sent" && (
                  <Check size={15} strokeWidth={2.4} />
                )}
                {message.receiptStatus === "delivered" && (
                  <CheckCheck size={16} strokeWidth={2.4} />
                )}
                {message.receiptStatus === "read" && (
                  <CheckCheck size={16} strokeWidth={2.4} />
                )}
              </span>
            )}
          </div>
        </div>

        {isOwn && message.status === "failed" && (
          <div className="status-line failed">
            Failed to send.
            <button type="button" onClick={onRetry}>
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
