"use client";

import { useEffect, useRef, useState } from "react";
import {
  apiListConversations,
  apiOpenConversation,
  apiSearchUsers,
  apiSendMessage,
  apiSendMediaMessage,
  generateClientId,
  ApiError,
  type ApiConversation,
  type ApiMessage,
  type ApiUser,
} from "@/lib/client/api";
import {
  Check,
  CornerUpRight,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  Search,
  Video,
  X,
} from "lucide-react";
import VerifiedBadge from "@/components/VerifiedBadge";

type LocalMessage = ApiMessage & {
  status: "sent" | "sending" | "failed";
  clientId?: string | null;
};

type RecipientItem = {
  id: string; // user id
  username: string;
  avatarUrl?: string | null;
  isVerified?: boolean;
  conversationId?: string;
};

function compareMessagesByTime(
  a: Pick<ApiMessage, "id" | "createdAt">,
  b: Pick<ApiMessage, "id" | "createdAt">
): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt - b.createdAt;
  }
  return String(a.id).localeCompare(String(b.id));
}

export default function ForwardModal({
  selectedMessages,
  currentConversationId,
  onClose,
  onForwardSuccess,
  onError,
}: {
  selectedMessages: LocalMessage[];
  currentConversationId?: string;
  onClose: () => void;
  onForwardSuccess: (targetConversationIds: string[]) => void;
  onError: (message: string) => void;
}) {
  const [conversations, setConversations] = useState<ApiConversation[]>([]);
  const [loadingChats, setLoadingChats] = useState(true);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ApiUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUsernames, setSelectedUsernames] = useState<Set<string>>(new Set());
  const [isForwarding, setIsForwarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Only auto-focus on desktop view; on mobile, wait until user taps search icon
    if (typeof window !== "undefined" && window.innerWidth >= 768) {
      searchInputRef.current?.focus();
    }
  }, []);

  const handleToggleMobileSearch = () => {
    setIsMobileSearchOpen((prev) => {
      const next = !prev;
      if (!next) {
        setQuery("");
      } else {
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
        });
      }
      return next;
    });
  };

  useEffect(() => {
    if (isMobileSearchOpen) {
      searchInputRef.current?.focus();
    }
  }, [isMobileSearchOpen]);

  useEffect(() => {
    let cancelled = false;
    apiListConversations()
      .then(({ conversations: list }) => {
        if (!cancelled) {
          setConversations(list);
          setLoadingChats(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadingChats(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      return;
    }

    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      apiSearchUsers(trimmed, controller.signal)
        .then(({ users }) => setSearchResults(users))
        .catch((err) => {
          if (err instanceof ApiError && err.status !== 0) {
            setError(err.message);
          }
        })
        .finally(() => setSearching(false));
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // Combine recent conversations and user search into recipient list
  const recipients: RecipientItem[] = [];
  const addedUsernames = new Set<string>();

  // Filter conversations matching query if query present
  const queryLower = query.trim().toLowerCase();
  for (const c of conversations) {
    if (queryLower && !c.otherUser.username.toLowerCase().includes(queryLower)) {
      continue;
    }
    recipients.push({
      id: c.otherUser.id,
      username: c.otherUser.username,
      avatarUrl: c.otherUser.avatarUrl,
      isVerified: c.otherUser.isVerified,
      conversationId: c.id,
    });
    addedUsernames.add(c.otherUser.username);
  }

  // Add search results not already in recent list
  for (const u of searchResults) {
    if (!addedUsernames.has(u.username)) {
      recipients.push({
        id: u.id,
        username: u.username,
        avatarUrl: u.avatarUrl,
        isVerified: u.isVerified,
      });
      addedUsernames.add(u.username);
    }
  }

  const toggleRecipient = (username: string) => {
    if (isForwarding) return;
    setSelectedUsernames((prev) => {
      const next = new Set(prev);
      if (next.has(username)) {
        next.delete(username);
      } else {
        next.add(username);
      }
      return next;
    });
  };

  const handleConfirmForward = async () => {
    if (isForwarding || selectedUsernames.size === 0) return;
    setIsForwarding(true);
    setError(null);

    try {
      const targetConvIds: string[] = [];
      const sortedMessages = [...selectedMessages].sort(compareMessagesByTime);

      for (const username of Array.from(selectedUsernames)) {
        let convId = recipients.find((r) => r.username === username)?.conversationId;

        if (!convId) {
          const { conversation } = await apiOpenConversation(username);
          convId = conversation.id;
        }

        if (!targetConvIds.includes(convId)) {
          targetConvIds.push(convId);
        }

        // Forward each selected message in chronological order
        for (const msg of sortedMessages) {
          const clientId = generateClientId();

          if (msg.type === "text") {
            await apiSendMessage(
              convId,
              msg.content ?? "",
              clientId,
              null,
              true
            );
          } else if (
            msg.type === "image" ||
            msg.type === "video" ||
            msg.type === "document" ||
            msg.type === "file"
          ) {
            await apiSendMediaMessage(convId, {
              type: (msg.type === "file" ? "document" : msg.type) as any,
              mediaKey: msg.mediaKey!,
              mediaSize: msg.mediaSize ?? 0,
              mediaOriginalSize: msg.mediaOriginalSize,
              mediaMimeType: msg.mediaMimeType ?? "application/octet-stream",
              mediaName: msg.mediaName ?? "file",
              mediaWidth: msg.mediaWidth,
              mediaHeight: msg.mediaHeight,
              durationMs: msg.durationMs,
              content: msg.content,
              clientId,
              isForwarded: true,
            });
          } else if (msg.type === "voice") {
            await apiSendMediaMessage(convId, {
              type: "voice",
              mediaKey: msg.mediaKey!,
              mediaSize: msg.mediaSize ?? 0,
              durationMs: msg.durationMs,
              mediaMimeType: "audio/webm",
              mediaName: "voice.webm",
              clientId,
              isForwarded: true,
            });
          }
        }
      }

      onForwardSuccess(targetConvIds);
      onClose();
    } catch (err: any) {
      console.error("Forwarding failed:", err);
      const msg = err instanceof ApiError ? err.message : "Failed to forward messages.";
      setError(msg);
      onError(msg);
      setIsForwarding(false);
    }
  };

  // Preview counts
  const textCount = selectedMessages.filter((m) => m.type === "text").length;
  const imageCount = selectedMessages.filter((m) => m.type === "image").length;
  const videoCount = selectedMessages.filter((m) => m.type === "video").length;
  const docCount = selectedMessages.filter(
    (m) => m.type === "document" || m.type === "file"
  ).length;
  const voiceCount = selectedMessages.filter((m) => m.type === "voice").length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Forward messages"
      className="forward-modal-overlay"
      onClick={onClose}
    >
      <div className="forward-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="forward-modal-header">
          <div className="forward-modal-title-row">
            <strong>Forward to…</strong>
            <div className="forward-modal-header-actions">
              <button
                type="button"
                className={`icon-btn forward-mobile-search-btn${isMobileSearchOpen ? " active" : ""}`}
                aria-label={isMobileSearchOpen ? "Close search" : "Search chats"}
                aria-expanded={isMobileSearchOpen}
                title={isMobileSearchOpen ? "Close search" : "Search"}
                onClick={handleToggleMobileSearch}
                disabled={isForwarding}
              >
                <Search size={18} strokeWidth={2} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close"
                onClick={onClose}
                disabled={isForwarding}
              >
                <X size={18} strokeWidth={2} />
              </button>
            </div>
          </div>

          {/* Selected message summary */}
          <div className="forward-preview-strip">
            <span className="forward-preview-count">
              {selectedMessages.length} {selectedMessages.length === 1 ? "message" : "messages"}
            </span>
            <div className="forward-preview-badges">
              {textCount > 0 && <span className="preview-badge">{textCount} text</span>}
              {imageCount > 0 && (
                <span className="preview-badge">
                  <ImageIcon size={12} /> {imageCount}
                </span>
              )}
              {videoCount > 0 && (
                <span className="preview-badge">
                  <Video size={12} /> {videoCount}
                </span>
              )}
              {docCount > 0 && (
                <span className="preview-badge">
                  <FileText size={12} /> {docCount}
                </span>
              )}
              {voiceCount > 0 && (
                <span className="preview-badge">
                  <Mic size={12} /> {voiceCount}
                </span>
              )}
            </div>
          </div>

          {/* Search */}
          <div className={`forward-search-wrap${isMobileSearchOpen ? " mobile-open" : ""}`}>
            <Search size={16} className="forward-search-icon" aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="text"
              className="forward-search-input"
              placeholder="Search chats or users"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={isForwarding}
            />
            {query && (
              <button
                type="button"
                className="forward-search-clear-btn"
                aria-label="Clear search"
                title="Clear search"
                onClick={() => {
                  setQuery("");
                  searchInputRef.current?.focus();
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="error-banner" role="alert" style={{ margin: "8px 16px" }}>
            {error}
          </div>
        )}

        {/* Recipients list */}
        <div className="forward-recipients-list">
          {loadingChats && recipients.length === 0 && (
            <div className="forward-empty-state">
              <Loader2 size={18} className="spin" aria-hidden="true" />
              <span>Loading chats…</span>
            </div>
          )}

          {!loadingChats && recipients.length === 0 && (
            <div className="forward-empty-state">
              {query.trim() ? "No users or chats found." : "No recent chats."}
            </div>
          )}

          {recipients.map((item) => {
            const isSelected = selectedUsernames.has(item.username);
            return (
              <button
                key={item.username}
                type="button"
                className={`forward-recipient-row${isSelected ? " selected" : ""}`}
                onClick={() => toggleRecipient(item.username)}
                disabled={isForwarding}
              >
                <span className="avatar" aria-hidden="true">
                  {item.avatarUrl ? (
                    <img src={item.avatarUrl} alt="" className="avatar-image" />
                  ) : (
                    item.username.slice(0, 1).toUpperCase()
                  )}
                </span>
                <div className="forward-recipient-info">
                  <span className="forward-recipient-name">
                    {item.username}
                    {item.isVerified && <VerifiedBadge size={15} />}
                  </span>
                  {item.conversationId && (
                    <span className="forward-recipient-sub">Recent chat</span>
                  )}
                </div>
                <span
                  className={`forward-checkbox${isSelected ? " checked" : ""}`}
                  aria-hidden="true"
                >
                  {isSelected && <Check size={14} strokeWidth={2.8} />}
                </span>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="forward-modal-footer">
          <span className="forward-footer-count">
            {selectedUsernames.size > 0
              ? `${selectedUsernames.size} ${selectedUsernames.size === 1 ? "chat" : "chats"} selected`
              : "Select recipient"}
          </span>
          <div className="forward-footer-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isForwarding}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary forward-submit-btn"
              onClick={handleConfirmForward}
              disabled={isForwarding || selectedUsernames.size === 0}
            >
              {isForwarding ? (
                <>
                  <Loader2 size={16} className="spin" />
                  <span>Forwarding…</span>
                </>
              ) : (
                <>
                  <CornerUpRight size={16} strokeWidth={2.2} />
                  <span>Forward</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
