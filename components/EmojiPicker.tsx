"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { EmojiClickData, EmojiStyle, SuggestionMode, Theme } from "emoji-picker-react";

const LibraryPicker = dynamic(() => import("emoji-picker-react"), {
  ssr: false,
  loading: () => <div className="emoji-picker-loading" aria-label="Loading emoji picker" />,
});

type EmojiPickerProps = {
  onClose: () => void;
  /** Existing MessageInput API. */
  onSelect?: (emoji: string) => void;
  /** Also expose the library's native callback shape for other callers. */
  onEmojiClick?: (emojiData: EmojiClickData) => void;
};

export default function EmojiPicker({ onSelect, onEmojiClick, onClose }: EmojiPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<Theme>("light" as Theme);

  useEffect(() => {
    const root = document.documentElement;
    const updateTheme = () => {
      const dark = root.dataset.theme
        ? root.dataset.theme === "dark"
        : window.matchMedia("(prefers-color-scheme: dark)").matches;
      setTheme((dark ? "dark" : "light") as Theme);
    };
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="emoji-picker" ref={ref} aria-label="Emoji picker">
      <LibraryPicker
        onEmojiClick={(emojiData) => {
          onEmojiClick?.(emojiData);
          onSelect?.(emojiData.emoji);
        }}
        theme={theme}
        emojiStyle={"google" as EmojiStyle}
        suggestedEmojisMode={"recent" as SuggestionMode}
        lazyLoadEmojis
        previewConfig={{ showPreview: true }}
        searchPlaceholder="Search emojis..."
        width="100%"
        height="min(420px, 58vh)"
      />
    </div>
  );
}
