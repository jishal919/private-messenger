"use client";

import { useEffect, useRef, useState } from "react";
import type { MediaCategory } from "@/lib/media/types";
import { Clock, FileText, Send, X, Zap } from "lucide-react";

export interface MediaPreviewItem {
  file: File | Blob;
  category: MediaCategory;
  filename: string;
  mimeType: string;
  previewUrl: string;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  originalSize: number;
  compressedSize: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function MediaPreviewModal({
  item,
  isUploading,
  uploadProgress,
  onSend,
  onCancel,
}: {
  item: MediaPreviewItem;
  isUploading: boolean;
  uploadProgress: number;
  onSend: (caption: string) => void;
  onCancel: () => void;
}) {
  const [caption, setCaption] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus caption input on mount
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const hasCompressionSavings =
    item.category === "image" &&
    item.compressedSize < item.originalSize &&
    item.originalSize - item.compressedSize > 10 * 1024;

  const savingsPercent = hasCompressionSavings
    ? Math.round(
        ((item.originalSize - item.compressedSize) / item.originalSize) * 100
      )
    : 0;

  return (
    <div
      className="media-preview-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Media preview"
    >
      <div className="media-preview-modal">
        {/* Header */}
        <div className="media-preview-header">
          <button
            type="button"
            className="media-preview-close-btn"
            onClick={onCancel}
            disabled={isUploading}
            aria-label="Cancel attachment"
            title="Cancel"
          >
            <X size={20} strokeWidth={2} />
          </button>
          <div className="media-preview-title">
            {item.category === "image"
              ? "Send Photo"
              : item.category === "video"
              ? "Send Video"
              : "Send Document"}
          </div>
          <div style={{ width: 36 }} />
        </div>

        {/* Media Preview Stage */}
        <div className="media-preview-body">
          {item.category === "image" ? (
            <div className="media-preview-image-wrap">
              <img
                src={item.previewUrl}
                alt="Preview"
                className="media-preview-image"
              />
            </div>
          ) : item.category === "video" ? (
            <div className="media-preview-video-wrap">
              <video
                src={item.previewUrl}
                controls
                playsInline
                className="media-preview-video"
              />
            </div>
          ) : (
            <div className="media-preview-doc-wrap">
              <div className="media-preview-doc-icon">
                <FileText size={48} strokeWidth={1.5} color="var(--accent, #3b82f6)" />
              </div>
              <div className="media-preview-doc-name">{item.filename}</div>
              <div className="media-preview-doc-size">
                {formatBytes(item.compressedSize)}
              </div>
            </div>
          )}

          {/* Compression Badge */}
          {hasCompressionSavings && (
            <div className="media-compression-badge">
              <Zap size={13} strokeWidth={2} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
              Compressed: {formatBytes(item.originalSize)} →{" "}
              {formatBytes(item.compressedSize)} ({savingsPercent}% smaller)
            </div>
          )}

          {item.category === "video" && item.durationMs && (
            <div className="media-compression-badge">
              <Clock size={13} strokeWidth={2} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
              Duration: {formatDuration(item.durationMs)} ·{" "}
              {formatBytes(item.compressedSize)}
            </div>
          )}

          {/* Upload Progress Overlay */}
          {isUploading && (
            <div className="media-upload-overlay">
              <div className="media-upload-spinner" />
              <div className="media-upload-progress-text">
                Uploading... {uploadProgress}%
              </div>
              <div className="media-upload-progress-track">
                <div
                  className="media-upload-progress-bar"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer with Caption & Action Buttons */}
        <div className="media-preview-footer">
          <input
            ref={inputRef}
            type="text"
            className="media-preview-caption-input"
            placeholder="Add a caption…"
            value={caption}
            disabled={isUploading}
            onChange={(e) => setCaption(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isUploading) {
                e.preventDefault();
                onSend(caption);
              }
            }}
          />

          <div className="media-preview-actions">
            <button
              type="button"
              className="media-preview-cancel-btn"
              onClick={onCancel}
              disabled={isUploading}
            >
              Cancel
            </button>
            <button
              type="button"
              className="media-preview-send-btn"
              onClick={() => onSend(caption)}
              disabled={isUploading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              {isUploading ? "Sending…" : (
                <>
                  Send
                  <Send size={15} strokeWidth={2} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
