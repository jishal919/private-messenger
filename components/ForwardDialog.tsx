"use client";

import { useEffect, useRef, useState } from "react";
import {
  apiListConversations,
  apiForwardMessage,
  ApiError,
  type ApiConversation,
  type ApiMessage,
} from "@/lib/client/api";
import { Check, Loader2, Search, X } from "lucide-react";
import VerifiedBadge from "@/components/VerifiedBadge";

interface ForwardDialogProps {
  message: ApiMessage;
  conversationId: string;
  onClose: () => void;
  onForwardedSuccess?: () => void;
}

export default function ForwardDialog({
  message,
  conversationId,
  onClose,
  onForwardedSuccess,
}: ForwardDialogProps) {
  const [conversations, setConversations] = useState<ApiConversation[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [forwarding, setForwarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
    let cancelled = false;

    apiListConversations()
      .then(({ conversations: list }) => {
        if (!cancelled) {
          setConversations(list);
          setLoadingList(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : "Could not load chats."
          );
          setLoadingList(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredConversations = conversations.filter((conv) =>
    conv.otherUser.username.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  const toggleSelect = (id: string) => {
    if (forwarding || success) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleForward = async () => {
    if (selectedIds.size === 0 || forwarding || success) return;

    setForwarding(true);
    setError(null);

    try {
      const targetIds = Array.from(selectedIds);
      await apiForwardMessage(conversationId, message.id, targetIds);
      setSuccess(true);
      if (onForwardedSuccess) {
        onForwardedSuccess();
      }
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to forward message. Please try again."
      );
      setForwarding(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="forward-dialog-title"
      className="forward-dialog-backdrop"
      onClick={onClose}
    >
      <div
        className="forward-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="forward-dialog-header">
          <strong id="forward-dialog-title" style={{ fontSize: 16 }}>
            Forward message
          </strong>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            onClick={onClose}
            disabled={forwarding}
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {error && (
          <div className="error-banner" role="alert" style={{ marginBottom: 8 }}>
            {error}
          </div>
        )}

        {success && (
          <div
            style={{
              padding: "10px 12px",
              background: "var(--surface-alt)",
              color: "var(--success)",
              borderRadius: 10,
              fontSize: 13.5,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <Check size={16} strokeWidth={2.5} />
            Forwarded successfully!
          </div>
        )}

        <div style={{ position: "relative", marginBottom: 8 }}>
          <input
            ref={searchInputRef}
            type="text"
            className="forward-dialog-search"
            placeholder="Search contacts…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            disabled={forwarding || success}
            style={{ paddingLeft: 34 }}
          />
          <Search
            size={16}
            style={{
              position: "absolute",
              left: 10,
              top: 11,
              color: "var(--text-muted)",
              pointerEvents: "none",
            }}
          />
        </div>

        <div className="forward-dialog-list">
          {loadingList ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "24px 0",
                color: "var(--text-muted)",
                fontSize: 13.5,
              }}
            >
              <Loader2 size={18} className="spin" />
              Loading conversations…
            </div>
          ) : filteredConversations.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "24px 0",
                color: "var(--text-muted)",
                fontSize: 13.5,
              }}
            >
              {searchQuery.trim() ? "No contacts found." : "No active chats found."}
            </div>
          ) : (
            filteredConversations.map((conv) => {
              const isSelected = selectedIds.has(conv.id);
              return (
                <button
                  key={conv.id}
                  type="button"
                  className={`forward-dialog-item${isSelected ? " selected" : ""}`}
                  onClick={() => toggleSelect(conv.id)}
                  disabled={forwarding || success}
                >
                  <span className="avatar" aria-hidden="true">
                    {conv.otherUser.avatarUrl ? (
                      <img
                        src={conv.otherUser.avatarUrl}
                        alt=""
                        className="avatar-image"
                        style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
                      />
                    ) : (
                      conv.otherUser.username.slice(0, 1).toUpperCase()
                    )}
                  </span>
                  <span className="conversation-meta" style={{ flex: 1, minWidth: 0 }}>
                    <span className="username" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <span className="username-text">@{conv.otherUser.username}</span>
                      {conv.otherUser.isVerified && <VerifiedBadge size={15} />}
                    </span>
                  </span>
                  <span className="forward-dialog-check" aria-hidden="true">
                    {isSelected && <Check size={13} strokeWidth={3} />}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="forward-dialog-actions">
          <button
            type="button"
            className="forward-cancel-btn"
            onClick={onClose}
            disabled={forwarding}
          >
            Cancel
          </button>
          <button
            type="button"
            className="forward-btn"
            onClick={handleForward}
            disabled={selectedIds.size === 0 || forwarding || success}
          >
            {forwarding ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Loader2 size={15} className="spin" />
                Forwarding…
              </span>
            ) : selectedIds.size > 0 ? (
              `Forward (${selectedIds.size})`
            ) : (
              "Forward"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
