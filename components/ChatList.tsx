"use client";

import type { ApiConversation } from "@/lib/client/api";
import type { SelectedConversation } from "@/components/ChatApp";
import { formatClockTime } from "@/lib/format-time";
import VerifiedBadge from "@/components/VerifiedBadge";

function formatTime(ts: number | null): string {
  if (!ts) return "";
  const date = new Date(ts);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return formatClockTime(date);
  }

  const diffDays = Math.floor(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) /
      86_400_000
  );
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) {
    return date.toLocaleDateString(undefined, { weekday: "short" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ChatList({
  conversations,
  loaded,
  selectedId,
  onSelect,
}: {
  conversations: ApiConversation[];
  loaded: boolean;
  selectedId: string | null;
  onSelect: (conv: SelectedConversation) => void;
}) {
  if (loaded && conversations.length === 0) {
    return (
      <div className="conversation-list">
        <p className="empty-state">
          No conversations yet. Tap “New conversation” to message someone by
          username.
        </p>
      </div>
    );
  }

  return (
    <div className="conversation-list" role="list">
      {conversations.map((conv) => (
        <button
          key={conv.id}
          type="button"
          role="listitem"
          className={
            "conversation-item" + (conv.id === selectedId ? " active" : "")
          }
          onClick={() =>
            onSelect({ id: conv.id, otherUser: conv.otherUser })
          }
        >
          <span className="avatar" aria-hidden="true">
            {conv.otherUser.avatarUrl ? (
              <img
                src={conv.otherUser.avatarUrl}
                alt=""
                className="avatar-image"
              />
            ) : (
              conv.otherUser.username.slice(0, 1).toUpperCase()
            )}
          </span>
          <span className="conversation-meta">
            <span className="name-row">
              <span className="username">
                <span className="username-text">{conv.otherUser.username}</span>
                {conv.otherUser.isVerified && <VerifiedBadge size={16} />}
              </span>
              <span className="time">{formatTime(conv.lastMessageAt)}</span>
            </span>
            <span className="preview">
              {conv.lastMessage
                ? (conv.lastMessageFromMe ? "You: " : "") + conv.lastMessage
                : "Say hello"}
            </span>
          </span>
          {conv.unread && <span className="unread-dot" aria-label="Unread" />}
        </button>
      ))}
    </div>
  );
}
