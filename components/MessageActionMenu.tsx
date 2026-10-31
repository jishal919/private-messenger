"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CornerUpLeft, Share2 } from "lucide-react";

interface MessageActionMenuProps {
  canReply: boolean;
  onReply: () => void;
  onForward: () => void;
  onClose: () => void;
  anchorEl: HTMLElement | null;
  isOwn: boolean;
}

export default function MessageActionMenu({
  canReply,
  onReply,
  onForward,
  onClose,
  anchorEl,
  isOwn,
}: MessageActionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!anchorEl) return;

    const rect = anchorEl.getBoundingClientRect();
    const menuWidth = 148;
    const menuHeight = 92;
    const padding = 8;

    let left: number;
    if (isOwn) {
      // Outgoing: try to place to the left of the anchor or aligned to right edge
      left = rect.right - menuWidth;
    } else {
      // Incoming: place aligned to left edge of anchor
      left = rect.left;
    }

    // Viewport containment: horizontal
    if (left + menuWidth > window.innerWidth - padding) {
      left = window.innerWidth - menuWidth - padding;
    }
    if (left < padding) {
      left = padding;
    }

    // Viewport containment: vertical
    let top = rect.bottom + 4;
    if (top + menuHeight > window.innerHeight - padding) {
      // Show above if it doesn't fit below
      top = Math.max(padding, rect.top - menuHeight - 4);
    }

    setCoords({ top, left });
  }, [anchorEl, isOwn]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }

    function handlePointerDownOutside(e: MouseEvent | TouchEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        anchorEl &&
        !anchorEl.contains(e.target as Node)
      ) {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDownOutside);
    document.addEventListener("touchstart", handlePointerDownOutside);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDownOutside);
      document.removeEventListener("touchstart", handlePointerDownOutside);
    };
  }, [anchorEl, onClose]);

  // Focus first button on mount
  useEffect(() => {
    if (coords && menuRef.current) {
      const firstBtn = menuRef.current.querySelector<HTMLButtonElement>("button");
      firstBtn?.focus();
    }
  }, [coords]);

  if (!coords) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Message options"
      className="msg-action-menu"
      style={{
        position: "fixed",
        top: coords.top,
        left: coords.left,
        zIndex: 200,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {canReply && (
        <button
          type="button"
          role="menuitem"
          className="msg-action-item"
          onClick={() => {
            onReply();
            onClose();
          }}
        >
          <CornerUpLeft size={16} strokeWidth={2} aria-hidden="true" />
          <span>Reply</span>
        </button>
      )}

      <button
        type="button"
        role="menuitem"
        className="msg-action-item"
        onClick={() => {
          onForward();
          onClose();
        }}
      >
        <Share2 size={16} strokeWidth={2} aria-hidden="true" />
        <span>Forward</span>
      </button>
    </div>,
    document.body
  );
}
