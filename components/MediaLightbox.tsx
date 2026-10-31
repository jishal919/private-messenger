"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";

export default function MediaLightbox({
  src,
  alt,
  filename,
  onClose,
}: {
  src: string;
  alt?: string;
  filename?: string;
  onClose: () => void;
}) {
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(src, { credentials: "same-origin" });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || alt || "image";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(src, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="media-lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      onClick={onClose}
    >
      <div className="media-lightbox-controls">
        <button
          type="button"
          className="media-lightbox-action-btn"
          onClick={handleDownload}
          aria-label="Download image"
          title="Download"
          disabled={downloading}
        >
          <Download size={20} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="media-lightbox-action-btn media-lightbox-close"
          onClick={onClose}
          aria-label="Close image preview"
          title="Close"
        >
          <X size={20} strokeWidth={2} />
        </button>
      </div>

      <div
        className="media-lightbox-content"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={alt || "Photo"}
          className="media-lightbox-image"
        />
      </div>
    </div>,
    document.body
  );
}
