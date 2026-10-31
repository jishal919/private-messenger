"use client";

import { useEffect, useRef, useState } from "react";
import { apiSearchUsers, ApiError, type ApiUser } from "@/lib/client/api";
import { X } from "lucide-react";
import VerifiedBadge from "@/components/VerifiedBadge";

export default function NewConversationModal({
  onClose,
  onOpenConversation,
}: {
  onClose: () => void;
  onOpenConversation: (username: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ApiUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      apiSearchUsers(trimmed, controller.signal)
        .then(({ users }) => setResults(users))
        .catch((err) => {
          if (err instanceof ApiError) setError(err.message);
        })
        .finally(() => setSearching(false));
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  async function handleOpen(username: string) {
    if (opening) return;
    setOpening(true);
    setError(null);
    try {
      await onOpenConversation(username);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setOpening(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Start a new conversation"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "10vh 16px 16px",
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <strong>New conversation</strong>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {error && <div className="error-banner" role="alert">{error}</div>}

        <input
          ref={inputRef}
          type="text"
          placeholder="Search by username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            width: "100%",
            padding: "11px 12px",
            border: "1px solid var(--border)",
            borderRadius: 10,
            background: "var(--surface-alt)",
            fontSize: 16,
            marginBottom: 10,
          }}
        />

        {searching && (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Searching…</p>
        )}

        {!searching && query.trim().length > 0 && results.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No users found.</p>
        )}

        <div>
          {results.map((user) => (
            <button
              key={user.id}
              type="button"
              className="conversation-item"
              style={{ borderBottom: "none", borderRadius: 10 }}
              disabled={opening}
              onClick={() => handleOpen(user.username)}
            >
              <span className="avatar" aria-hidden="true">
                {user.username.slice(0, 1)}
              </span>
              <span className="conversation-meta">
                <span className="search-result-username">
                  @{user.username}
                  {user.isVerified && <VerifiedBadge size={16} />}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
