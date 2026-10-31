"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  apiLoadLatestMessages,
  apiLoadNewMessages,
  apiLoadOlderMessages,
  apiLoadMessagesAround,
  apiSendMessage,
  apiSendVoiceMessage,
  apiLoadReceipts,
  apiMarkConversationRead,
  apiLoadConversationStatus,
  apiDeleteMessage,
  apiUndoDeleteMessage,
  generateClientId,
  ApiError,
  type ApiConversationStatus,
  type ApiMessage,
  type ApiReplyPreview,
  type ApiUser,
} from "@/lib/client/api";
import type { SelectedConversation } from "@/components/ChatApp";
import MessageBubble from "@/components/MessageBubble";
import MessageInput from "@/components/MessageInput";
import ForwardModal from "@/components/ForwardModal";
import { ArrowDown, ArrowLeft, Copy, CornerUpRight, Reply, Trash2, X } from "lucide-react";
import { formatClockTime } from "@/lib/format-time";
import VerifiedBadge from "@/components/VerifiedBadge";

type LocalMessage = ApiMessage & {
  status: "sent" | "sending" | "failed";
  clientId?: string | null;
};

const NEW_MESSAGE_POLL_MS = 2000;
const BACKGROUND_POLL_MS = 4000;
const STATUS_POLL_MS = 2_000;
const NEAR_BOTTOM_THRESHOLD = 140;
const NEAR_TOP_THRESHOLD = 60;

function compareMessagesByTime(
  a: Pick<ApiMessage, "id" | "createdAt">,
  b: Pick<ApiMessage, "id" | "createdAt">
): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt - b.createdAt;
  }

  /*
   * createdAt is millisecond precision, so two messages can
   * occasionally share the same timestamp. The id tie-breaker
   * keeps the client ordering deterministic.
   */
  return String(a.id).localeCompare(String(b.id));
}

function sortMessagesChronologically<T extends Pick<ApiMessage, "id" | "createdAt">>(
  messageList: T[]
): T[] {
  return [...messageList].sort(compareMessagesByTime);
}

function getNewestMessage<T extends Pick<ApiMessage, "id" | "createdAt">>(
  messageList: T[]
): T | null {
  if (messageList.length === 0) {
    return null;
  }

  return messageList.reduce((newest, message) =>
    compareMessagesByTime(message, newest) > 0
      ? message
      : newest
  );
}

export default function ChatWindow({
  currentUser,
  conversation,
  onBack,
  onMessageSent,
  onIncomingMessage,
  onError,
}: {
  currentUser: ApiUser;
  conversation: SelectedConversation | null;
  onBack: () => void;
  onMessageSent: (
    conversationId: string,
    content: string,
    createdAt: number
  ) => void;
  onIncomingMessage: (
    conversationId: string,
    content: string,
    createdAt: number,
    fromMe: boolean
  ) => void;
  onError: (message: string) => void;
}) {
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ApiReplyPreview | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [isAwayFromBottom, setIsAwayFromBottom] = useState(false);
  const [hasMoreAfter, setHasMoreAfter] = useState(false);
  const [loadingNewer, setLoadingNewer] = useState(false);
  const [conversationStatus, setConversationStatus] =
    useState<ApiConversationStatus | null>(null);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(
    new Set()
  );
  const [contextMenu, setContextMenu] = useState<{
    message: LocalMessage;
    x: number;
    y: number;
    rect?: DOMRect;
  } | null>(null);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState<{
    messageIds: string[];
    canDeleteForEveryone: boolean;
  } | null>(null);
  const [undoDelete, setUndoDelete] = useState<{
    messages: LocalMessage[];
    conversationId: string;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const lastKnownIdRef = useRef<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const isNearBottomRef = useRef(true);
  const initialMessagesLoadedRef = useRef(false);
  const knownMessageIdsRef = useRef(new Set<string>());
  const loadingNewerRef = useRef(false);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const receiptPollTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSelectionMode = selectedMessageIds.size > 0;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!undoDelete) return;
    const timer = setTimeout(() => setUndoDelete(null), 5000);
    return () => clearTimeout(timer);
  }, [undoDelete]);

  useEffect(() => {
    setSelectedMessageIds(new Set());
    setContextMenu(null);
    setShowForwardModal(false);
    setDeleteModal(null);
    setUndoDelete(null);
  }, [conversation?.id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (deleteModal) {
          setDeleteModal(null);
        } else if (contextMenu) {
          setContextMenu(null);
        } else if (selectedMessageIds.size > 0) {
          setSelectedMessageIds(new Set());
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [contextMenu, deleteModal, selectedMessageIds.size]);

  const clearSelection = useCallback(() => {
    setSelectedMessageIds(new Set());
    setContextMenu(null);
  }, []);

  const handleToggleSelect = useCallback((messageId: string) => {
    setContextMenu(null);
    setSelectedMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }, []);

  const handleLongPress = useCallback(
    (message: LocalMessage) => {
      setContextMenu(null);
      setSelectedMessageIds(new Set([message.id]));
    },
    []
  );

  const handleOpenMenu = useCallback(
    (message: LocalMessage, pos: { x: number; y: number; rect?: DOMRect }) => {
      setContextMenu({ message, x: pos.x, y: pos.y, rect: pos.rect });
    },
    []
  );

  const handleCopyText = useCallback(
    async (textToCopy: string) => {
      const text = textToCopy.trim();
      if (!text) return;
      let ok = false;
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          ok = true;
        }
      } catch {
        // fallback
      }
      if (!ok) {
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          ta.style.pointerEvents = "none";
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          ok = document.execCommand("copy");
          document.body.removeChild(ta);
        } catch {
          ok = false;
        }
      }
      if (ok) {
        setToast("Copied");
      } else {
        onError("Could not copy text to clipboard.");
      }
    },
    [onError]
  );

  const handleDeleteMessages = useCallback(
    (ids: string[], deleteFor: "everyone" | "me") => {
      if (!conversation) return;
      const convId = conversation.id;
      const targetMessages = messages.filter((m) => ids.includes(m.id));

      clearSelection();
      setDeleteModal(null);

      if (deleteFor === "everyone") {
        setUndoDelete(null);
        setMessages((prev) =>
          prev.map((m) =>
            ids.includes(m.id)
              ? {
                  ...m,
                  deletedForEveryone: true,
                  content: null,
                  mediaKey: null,
                  mediaName: null,
                  durationMs: null,
                  type: "text",
                  replyTo: null,
                  replyToMessageId: null,
                  isForwarded: false,
                }
              : m
          )
        );
        Promise.all(
          ids.map((id) => apiDeleteMessage(convId, id, "everyone"))
        ).catch(() => {
          onError("Failed to delete message for everyone.");
        });
      } else {
        setMessages((prev) => prev.filter((m) => !ids.includes(m.id)));
        setUndoDelete({
          messages: targetMessages,
          conversationId: convId,
        });
        Promise.all(
          ids.map((id) => apiDeleteMessage(convId, id, "me"))
        ).catch(() => {
          onError("Failed to delete message.");
        });
      }
    },
    [conversation, messages, clearSelection, onError]
  );

  const handleUndoDelete = useCallback(async () => {
    if (!undoDelete) return;
    const { messages: restoredMsgs, conversationId: convId } = undoDelete;
    setUndoDelete(null);
    setMessages((prev) =>
      sortMessagesChronologically([...prev, ...restoredMsgs])
    );
    try {
      await Promise.all(
        restoredMsgs.map((m) => apiUndoDeleteMessage(convId, m.id))
      );
    } catch {
      onError("Failed to restore message.");
    }
  }, [undoDelete, onError]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const el = listRef.current;

      if (!el) return;

      el.scrollTo({
        top: el.scrollHeight,
        behavior,
      });
    },
    []
  );

  /*
   * Mark the latest incoming message as read.
   *
   * This only happens while the browser tab is visible.
   */
  const markLatestMessageAsRead = useCallback(
    async (messageList: LocalMessage[]) => {
      if (
        !conversation ||
        document.visibilityState !== "visible"
      ) {
        return;
      }

      const incomingMessages = messageList.filter(
        (message) =>
          message.senderId !== currentUser.id &&
          message.status !== "failed"
      );

      if (incomingMessages.length === 0) {
        return;
      }

      const latestMessage = incomingMessages.reduce(
        (latest, message) =>
          message.createdAt > latest.createdAt
            ? message
            : latest,
        incomingMessages[0]
      );

      try {
        await apiMarkConversationRead(
          conversation.id,
          latestMessage.id
        );
      } catch {
        // A later polling cycle can retry.
      }
    },
    [conversation, currentUser.id]
  );

  /*
   * Update the receipt state of our own messages.
   *
   * This does NOT download messages again.
   * It only loads the recipient's delivered/read cursors.
   */
  const updateReceiptStatuses = useCallback(
    async (conversationId: string) => {
      try {
        const { delivered, read } =
          await apiLoadReceipts(conversationId);

        setMessages((prev) => {
          let changed = false;

          const updated = prev.map((message) => {
            if (
              message.senderId !== currentUser.id ||
              message.status !== "sent"
            ) {
              return message;
            }

            let receiptStatus:
              | "sent"
              | "delivered"
              | "read" = "sent";

            if (
              read &&
              message.createdAt <= read.createdAt
            ) {
              receiptStatus = "read";
            } else if (
              delivered &&
              message.createdAt <= delivered.createdAt
            ) {
              receiptStatus = "delivered";
            }

            if (
              message.receiptStatus !== receiptStatus
            ) {
              changed = true;

              return {
                ...message,
                receiptStatus,
              };
            }

            return message;
          });

          return changed ? updated : prev;
        });
      } catch {
        // Receipt polling can retry later.
      }
    },
    [currentUser.id]
  );

  /*
   * Load the conversation fresh whenever the
   * selected conversation changes.
   */
  useEffect(() => {
    if (!conversation) {
      setMessages([]);
      setConversationStatus(null);
      conversationIdRef.current = null;
      initialMessagesLoadedRef.current = false;
      knownMessageIdsRef.current.clear();
      setReplyingTo(null);
      setNewMessageCount(0);
      return;
    }

    let cancelled = false;

    conversationIdRef.current = conversation.id;
    setMessages([]);
    setHasMore(false);
    setLoading(true);
    lastKnownIdRef.current = null;
    initialMessagesLoadedRef.current = false;
    knownMessageIdsRef.current.clear();
    isNearBottomRef.current = true;
    setReplyingTo(null);
    setNewMessageCount(0);
    setIsAwayFromBottom(false);
    setHasMoreAfter(false);

    apiLoadLatestMessages(conversation.id)
      .then(({ messages: fetched, hasMore: more }) => {
        if (cancelled) return;

        /*
         * The content adapter may return "latest" messages
         * newest-first. The UI must always keep messages
         * oldest -> newest so the newest bubble is at the bottom.
         */
        const loadedMessages = sortMessagesChronologically(
          fetched.map((m) => ({
            ...m,
            status: "sent" as const,
          }))
        );

        setMessages(loadedMessages);
        knownMessageIdsRef.current = new Set(loadedMessages.map((m) => m.id));
        initialMessagesLoadedRef.current = true;
        setHasMore(more);

        const newestLoaded = getNewestMessage(loadedMessages);

        lastKnownIdRef.current =
          newestLoaded?.id ?? null;

        requestAnimationFrame(() => {
          markLatestMessageAsRead(
            loadedMessages
          );

          scrollToBottom("auto");
        });
      })
      .catch((err) => {
        if (!cancelled) {
          onError(
            err instanceof ApiError
              ? err.message
              : "Couldn't load messages."
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };

    // These callbacks intentionally use the conversation
    // that existed when this effect started.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id]);

  const activeConversationId = conversation?.id;

  useEffect(() => {
    if (!activeConversationId) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let inFlight = false;

    async function poll() {
      if (stopped || !activeConversationId || inFlight) return;

      inFlight = true;

      try {
        const status =
          await apiLoadConversationStatus(
            activeConversationId
          );

        if (!stopped) {
          setConversationStatus(status);
        }
      } catch {
        // Keep the last known status briefly.
      } finally {
        inFlight = false;
        if (!stopped) {
          const delay =
            document.visibilityState === "visible"
              ? STATUS_POLL_MS
              : BACKGROUND_POLL_MS;
          timer = setTimeout(poll, delay);
        }
      }
    }

    function onVisibility() {
      if (document.visibilityState === "visible") {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }

        if (!inFlight) {
          poll();
        }
      }
    }

    setConversationStatus(null);
    poll();

    document.addEventListener(
      "visibilitychange",
      onVisibility
    );

    return () => {
      stopped = true;

      if (timer) {
        clearTimeout(timer);
      }

      document.removeEventListener(
        "visibilitychange",
        onVisibility
      );
    };
  }, [activeConversationId]);

  /*
   * Poll for new messages while this conversation is open.
   */
  useEffect(() => {
    if (!conversation) return;

    let timer: ReturnType<typeof setTimeout> | null =
      null;

    let stopped = false;

    async function poll() {
      const convId = conversationIdRef.current;

      if (convId == null || stopped) return;

      if (!initialMessagesLoadedRef.current) {
        timer = setTimeout(poll, NEW_MESSAGE_POLL_MS);
        return;
      }

      try {
        const { messages: fresh, deletedMessageIds } =
          await apiLoadNewMessages(
            convId,
            lastKnownIdRef.current
          );

        if (
          conversationIdRef.current === convId &&
          deletedMessageIds &&
          deletedMessageIds.length > 0
        ) {
          const delSet = new Set(deletedMessageIds);
          setMessages((prev) => {
            let changed = false;
            const updated = prev.map((m) => {
              if (delSet.has(m.id) && !m.deletedForEveryone) {
                changed = true;
                return {
                  ...m,
                  deletedForEveryone: true,
                  content: null,
                  mediaKey: null,
                  mediaName: null,
                  durationMs: null,
                  type: "text" as const,
                  replyTo: null,
                  replyToMessageId: null,
                  isForwarded: false,
                };
              }
              return m;
            });
            return changed ? updated : prev;
          });
        }

        if (
          fresh.length > 0 &&
          conversationIdRef.current === convId
        ) {
          const freshMessages =
            sortMessagesChronologically(
              fresh.map((m) => ({
                ...m,
                status: "sent" as const,
              }))
            );

          const additions = freshMessages.filter((m) => {
            if (knownMessageIdsRef.current.has(m.id)) return false;
            knownMessageIdsRef.current.add(m.id);
            return true;
          });

          const newestFresh = getNewestMessage(additions);

          if (newestFresh) {
            lastKnownIdRef.current =
              newestFresh.id;
          }

          setMessages((prev) => sortMessagesChronologically([
            ...prev.filter((m) => !additions.some((a) => a.id === m.id)),
            ...additions,
          ]));

          /*
           * If these are incoming messages and the
           * conversation is currently visible, mark
           * the newest one as read.
           */
          const incomingFresh =
            additions.filter(
              (message) =>
                message.senderId !== currentUser.id
            );

          const latestIncoming =
            getNewestMessage(incomingFresh);

          if (
            document.visibilityState === "visible" &&
            isNearBottomRef.current && latestIncoming
          ) {
            void apiMarkConversationRead(
              convId,
              latestIncoming.id
            );
          }

          const latestFresh = getNewestMessage(additions);

          if (latestFresh) {
            onIncomingMessage(
              convId,
              latestFresh.type === "voice"
                ? "🎤 Voice message"
                : latestFresh.type === "image"
                ? "📷 Photo"
                : latestFresh.type === "video"
                ? "🎥 Video"
                : latestFresh.type === "document"
                ? "📄 Document"
                : (latestFresh.content ?? ""),
              latestFresh.createdAt,
              latestFresh.senderId === currentUser.id
            );
          }

          if (incomingFresh.length > 0 && !isNearBottomRef.current) {
            setNewMessageCount((count) => count + incomingFresh.length);
          }

          if (isNearBottomRef.current) {
            requestAnimationFrame(() =>
              scrollToBottom("smooth")
            );
          }
        }
      } catch {
        // Network hiccup — try again on the next tick.
      }

      if (stopped) return;

      const delay =
        document.visibilityState === "visible"
          ? NEW_MESSAGE_POLL_MS
          : BACKGROUND_POLL_MS;

      timer = setTimeout(poll, delay);
    }

    function onVisibility() {
      if (
        document.visibilityState === "visible"
      ) {
        if (timer) {
          clearTimeout(timer);
        }

        poll();
      }
    }

    timer = setTimeout(
      poll,
      NEW_MESSAGE_POLL_MS
    );

    document.addEventListener(
      "visibilitychange",
      onVisibility
    );

    return () => {
      stopped = true;

      if (timer) {
        clearTimeout(timer);
      }

      document.removeEventListener(
        "visibilitychange",
        onVisibility
      );
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    conversation?.id,
    currentUser.id,
    onIncomingMessage,
    scrollToBottom,
  ]);

  /*
   * Poll receipt changes independently.
   *
   * This lets the sender's:
   *
   *   ✓  ->  ✓✓  ->  highlighted ✓✓
   *
   * update without downloading the conversation again.
   */
  useEffect(() => {
  if (!conversation) return;

  const conversationId = conversation.id;
  let stopped = false;

  const poll = async () => {
    await updateReceiptStatuses(conversationId);

    if (stopped) return;

    receiptPollTimerRef.current = setTimeout(
      poll,
      NEW_MESSAGE_POLL_MS
    );
  };

  poll();

  return () => {
    stopped = true;

    if (receiptPollTimerRef.current) {
      clearTimeout(receiptPollTimerRef.current);
      receiptPollTimerRef.current = null;
    }
  };
}, [conversation, updateReceiptStatuses]);

  const handleScroll = useCallback(async () => {
    const el = listRef.current;

    if (!el) return;

    const distanceFromBottom =
      el.scrollHeight -
      el.scrollTop -
      el.clientHeight;

    const wasNearBottom = isNearBottomRef.current;
    isNearBottomRef.current = distanceFromBottom < NEAR_BOTTOM_THRESHOLD;
    setIsAwayFromBottom(!isNearBottomRef.current);

    if (isNearBottomRef.current) {
      setNewMessageCount(0);
      if (!wasNearBottom) void markLatestMessageAsRead(messages);
    }

    if (
      distanceFromBottom < NEAR_BOTTOM_THRESHOLD &&
      hasMoreAfter && !loadingNewerRef.current && conversation && messages.length > 0
    ) {
      loadingNewerRef.current = true;
      setLoadingNewer(true);
      try {
        const { messages: newer, hasMore: more } = await apiLoadNewMessages(
          conversation.id,
          messages[messages.length - 1].id
        );
        const additions = newer.filter((m) => !knownMessageIdsRef.current.has(m.id));
        additions.forEach((m) => knownMessageIdsRef.current.add(m.id));
        if (additions.length) {
          setMessages((prev) => sortMessagesChronologically([
            ...prev,
            ...additions.map((m) => ({ ...m, status: "sent" as const })),
          ]));
        }
        setHasMoreAfter(Boolean(more));
      } catch {
        // The next scroll can retry loading the newer page.
      } finally {
        loadingNewerRef.current = false;
        setLoadingNewer(false);
      }
    }

    if (
      el.scrollTop < NEAR_TOP_THRESHOLD &&
      hasMore &&
      !loadingOlder &&
      conversation &&
      messages.length > 0
    ) {
      setLoadingOlder(true);

      const oldestId = messages[0].id;
      const previousScrollHeight =
        el.scrollHeight;

      try {
        const {
          messages: older,
          hasMore: more,
        } = await apiLoadOlderMessages(
          conversation.id,
          oldestId
        );

        const olderMessages =
          sortMessagesChronologically(
            older.map((m) => ({
              ...m,
              status: "sent" as const,
            }))
          );

        setMessages((prev) => {
          const existingIds = new Set(
            prev.map((m) => m.id)
          );

          const additions = olderMessages.filter(
            (m) => !existingIds.has(m.id)
          );

          return additions.length > 0
            ? sortMessagesChronologically([
                ...additions,
                ...prev,
              ])
            : prev;
        });

        setHasMore(more);

        requestAnimationFrame(() => {
          if (!listRef.current) return;

          listRef.current.scrollTop =
            listRef.current.scrollHeight -
            previousScrollHeight +
            el.scrollTop;
        });
      } catch (err) {
        onError(
          err instanceof ApiError
            ? err.message
            : "Couldn't load older messages."
        );
      } finally {
        setLoadingOlder(false);
      }
    }
  }, [
    conversation,
    hasMore,
    hasMoreAfter,
    loadingOlder,
    markLatestMessageAsRead,
    messages,
    onError,
  ]);

  const makeReplyPreview = useCallback((message: LocalMessage): ApiReplyPreview => {
    const mediaPreview = message.type === "image" ? "Photo"
      : message.type === "video" ? "Video"
      : message.type === "voice" ? "Voice message"
      : message.type === "document" || message.type === "file" ? (message.mediaName || "Document")
      : (message.content || "Message unavailable");
    return {
      id: message.id,
      senderId: message.senderId,
      senderUsername: message.senderId === currentUser.id
        ? currentUser.username
        : conversation?.otherUser.username ?? "Unknown",
      type: message.type,
      preview: mediaPreview,
      available: true,
    };
  }, [conversation?.otherUser.username, currentUser.id, currentUser.username]);

  const jumpToMessage = useCallback(async (messageId: string) => {
    if (!conversation) return;
    let targetExists = messages.some((message) => message.id === messageId);

    if (!targetExists) {
      try {
        const result = await apiLoadMessagesAround(conversation.id, messageId);
        const loaded = sortMessagesChronologically(result.messages.map((m) => ({
          ...m,
          status: "sent" as const,
        })));
        knownMessageIdsRef.current = new Set(loaded.map((m) => m.id));
        setMessages(loaded);
        setHasMore(result.hasMoreBefore);
        setHasMoreAfter(result.hasMoreAfter);
        lastKnownIdRef.current = result.latestMessageId;
        targetExists = loaded.some((message) => message.id === messageId);
      } catch (err) {
        onError(err instanceof ApiError ? err.message : "Message unavailable.");
        return;
      }
    }

    if (!targetExists) {
      onError("Message unavailable.");
      return;
    }

    setHighlightedMessageId(messageId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedMessageId(null), 1800);
    requestAnimationFrame(() => {
      const element = Array.from(document.querySelectorAll<HTMLElement>("[data-message-id]"))
        .find((node) => node.dataset.messageId === messageId);
      const list = listRef.current;
      if (element && list) {
        const listRect = list.getBoundingClientRect();
        const targetRect = element.getBoundingClientRect();
        list.scrollTo({
          top: list.scrollTop + targetRect.top - listRect.top - (list.clientHeight - targetRect.height) / 2,
          behavior: "smooth",
        });
      }
    });
    const original = messages.find((message) => message.id === messageId);
    if (original && original.senderId !== currentUser.id && document.visibilityState === "visible") {
      void apiMarkConversationRead(conversation.id, messageId);
    }
  }, [conversation, currentUser.id, messages, onError]);

  const sendMessage = useCallback(
    async (content: string, replyToMessageId?: string | null) => {
      if (!conversation) return;

      const clientId = generateClientId();
      const tempId = `pending-${clientId}`;
      const createdAt = Date.now();

      setMessages((prev) => [
        ...prev,
        {
          id: tempId,
          senderId: currentUser.id,
          type: "text",
          content,
          replyToMessageId: replyToMessageId ?? null,
          replyTo: replyingTo?.id === replyToMessageId ? replyingTo : null,
          mediaKey: null,
          mediaSize: null,
          durationMs: null,
          createdAt,
          receiptStatus: "sent",
          status: "sending",
          clientId,
        },
      ]);

      requestAnimationFrame(() =>
        scrollToBottom("smooth")
      );

      try {
        const { message } =
          await apiSendMessage(
            conversation.id,
            content,
            clientId,
            replyToMessageId
          );

        setMessages((prev) =>
          prev.map((m) =>
            m.clientId === clientId
              ? {
                  ...message,
                  status: "sent" as const,
                  clientId,
                }
              : m
          )
        );

        lastKnownIdRef.current =
          message.id;

        onMessageSent(
          conversation.id,
          message.content ?? "",
          message.createdAt
        );
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.clientId === clientId
              ? {
                  ...m,
                  status: "failed" as const,
                }
              : m
          )
        );

        onError(
          err instanceof ApiError
            ? err.message
            : "Message could not be sent."
        );
      }
    },
    [
      conversation,
      currentUser.id,
      replyingTo,
      onError,
      onMessageSent,
      scrollToBottom,
    ]
  );

  const handleMediaSent = useCallback(
    (message: ApiMessage) => {
      if (!conversation) return;

      const localMsg: LocalMessage = {
        ...message,
        status: "sent",
        clientId: message.clientId ?? undefined,
      };

      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        if (existingIds.has(message.id)) {
          return prev.map((m) => (m.id === message.id ? localMsg : m));
        }
        if (message.clientId) {
          const matchClient = prev.find((m) => m.clientId === message.clientId);
          if (matchClient) {
            return prev.map((m) => (m.clientId === message.clientId ? localMsg : m));
          }
        }
        return [...prev, localMsg];
      });

      lastKnownIdRef.current = message.id;

      const previewText =
        message.type === "image"
          ? "📷 Photo"
          : message.type === "video"
          ? "🎥 Video"
          : message.type === "document"
          ? "📄 Document"
          : message.type === "voice"
          ? "🎤 Voice message"
          : message.content ?? "";

      onMessageSent(conversation.id, previewText, message.createdAt);

      requestAnimationFrame(() => scrollToBottom("smooth"));
    },
    [conversation, onMessageSent, scrollToBottom]
  );

  const sendVoiceMessage = useCallback(
    async (audioBlob: Blob, durationMs: number, replyToMessageId?: string | null) => {
      if (!conversation) return;

      const clientId = generateClientId();
      const tempId = `pending-${clientId}`;
      const createdAt = Date.now();

      setMessages((prev) => [
        ...prev,
        {
          id: tempId,
          senderId: currentUser.id,
          type: "voice",
          content: null,
          replyToMessageId: replyToMessageId ?? null,
          replyTo: replyingTo?.id === replyToMessageId ? replyingTo : null,
          mediaKey: null,
          mediaSize: audioBlob.size,
          durationMs: Math.round(durationMs),
          createdAt,
          receiptStatus: "sent",
          status: "sending",
          clientId,
        },
      ]);

      requestAnimationFrame(() =>
        scrollToBottom("smooth")
      );

      try {
        const { message } =
          await apiSendVoiceMessage(
            conversation.id,
            audioBlob,
            durationMs,
            clientId,
            replyToMessageId
          );

        setMessages((prev) =>
          prev.map((m) =>
            m.clientId === clientId
              ? {
                  ...message,
                  status: "sent" as const,
                  clientId,
                }
              : m
          )
        );

        lastKnownIdRef.current =
          message.id;

        onMessageSent(
          conversation.id,
          "🎤 Voice message",
          message.createdAt
        );
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.clientId === clientId
              ? {
                  ...m,
                  status: "failed" as const,
                }
              : m
          )
        );

        onError(
          err instanceof ApiError
            ? err.message
            : "Voice message could not be sent."
        );
      }
    },
    [
      conversation,
      currentUser.id,
      replyingTo,
      onError,
      onMessageSent,
      scrollToBottom,
    ]
  );



  const retryMessage = useCallback(
    async (
      clientId: string | null | undefined,
      content: string,
      replyToMessageId?: string | null
    ) => {
      if (!conversation || !clientId) {
        return;
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.clientId === clientId
            ? {
                ...m,
                status: "sending" as const,
              }
            : m
        )
      );

      try {
        const { message } =
          await apiSendMessage(
            conversation.id,
            content,
            clientId,
            replyToMessageId
          );

        setMessages((prev) =>
          prev.map((m) =>
            m.clientId === clientId
              ? {
                  ...message,
                  status: "sent" as const,
                  clientId,
                }
              : m
          )
        );

        lastKnownIdRef.current =
          message.id;

        onMessageSent(
          conversation.id,
          message.content ?? "",
          message.createdAt
        );
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.clientId === clientId
              ? {
                  ...m,
                  status: "failed" as const,
                }
              : m
          )
        );

        onError(
          err instanceof ApiError
            ? err.message
            : "Message could not be sent."
        );
      }
    },
    [
      conversation,
      onError,
      onMessageSent,
    ]
  );

  const goToLatest = useCallback(async () => {
    if (!conversation) return;
    let cursor = messages[messages.length - 1]?.id ?? null;
    let more = hasMoreAfter;
    const collected: LocalMessage[] = [];
    try {
      while (more && cursor) {
        const result = await apiLoadNewMessages(conversation.id, cursor);
        const additions = result.messages.filter((message) => !knownMessageIdsRef.current.has(message.id));
        additions.forEach((message) => knownMessageIdsRef.current.add(message.id));
        collected.push(...additions.map((message) => ({ ...message, status: "sent" as const })));
        const last = result.messages[result.messages.length - 1];
        if (!last || last.id === cursor) break;
        cursor = last.id;
        more = Boolean(result.hasMore);
      }
    } catch {
      onError("Couldn't load the latest messages.");
      return;
    }
    if (collected.length) setMessages((prev) => sortMessagesChronologically([...prev, ...collected]));
    setHasMoreAfter(more);
    setNewMessageCount(0);
    setIsAwayFromBottom(false);
    isNearBottomRef.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToBottom("smooth")));
    void markLatestMessageAsRead([...messages, ...collected]);
  }, [conversation, hasMoreAfter, markLatestMessageAsRead, messages, onError, scrollToBottom]);

  if (!conversation) {
    return (
      <div className="chat-window">
        <div
          className="empty-state"
          style={{ margin: "auto" }}
        >
          Select a conversation, or start a new
          one.
        </div>
      </div>
    );
  }

  return (
    <div className="chat-window">
      {isSelectionMode ? (
        <div className="chat-window-header selection-toolbar">
          <button
            type="button"
            className="selection-close-btn"
            aria-label="Clear selection"
            title="Clear selection"
            onClick={clearSelection}
          >
            <X size={20} strokeWidth={2} />
          </button>

          <div className="selection-count-wrap">
            <span className="selection-count">
              {selectedMessageIds.size} selected
            </span>
          </div>

          <div className="selection-header-actions">
            {(() => {
              const selectedList = messages.filter((m) =>
                selectedMessageIds.has(m.id)
              );
              const singleMsg =
                selectedList.length === 1 ? selectedList[0] : null;
              const canReply =
                singleMsg !== null &&
                singleMsg.status === "sent" &&
                !singleMsg.deletedForEveryone;
              const canCopy =
                selectedList.length > 0 &&
                selectedList.every(
                  (m) =>
                    !m.deletedForEveryone &&
                    m.type === "text" &&
                    Boolean(m.content && m.content.trim())
                );
              const canForward =
                selectedList.length > 0 &&
                selectedList.every((m) => !m.deletedForEveryone);

              return (
                <>
                  {canReply && (
                    <button
                      type="button"
                      className="header-action-btn"
                      aria-label="Reply"
                      title="Reply"
                      onClick={() => {
                        setReplyingTo(makeReplyPreview(singleMsg!));
                        clearSelection();
                      }}
                    >
                      <Reply size={18} strokeWidth={2} />
                    </button>
                  )}

                  {canCopy && (
                    <button
                      type="button"
                      className="header-action-btn"
                      aria-label={
                        selectedList.length === 1
                          ? "Copy message"
                          : "Copy selected messages"
                      }
                      title="Copy"
                      onClick={() => {
                        const text = selectedList
                          .map((m) => m.content!.trim())
                          .join("\n\n");
                        void handleCopyText(text);
                        clearSelection();
                      }}
                    >
                      <Copy size={18} strokeWidth={2} />
                    </button>
                  )}

                  <button
                    type="button"
                    className="header-action-btn header-action-btn-danger"
                    aria-label={
                      selectedList.length === 1
                        ? "Delete message"
                        : "Delete selected messages"
                    }
                    title="Delete"
                    onClick={() => {
                      const canDeleteForEveryone =
                        selectedList.length > 0 &&
                        selectedList.every(
                          (m) =>
                            !m.deletedForEveryone &&
                            m.senderId === currentUser.id &&
                            m.status === "sent"
                        );
                      setDeleteModal({
                        messageIds: [...selectedMessageIds],
                        canDeleteForEveryone,
                      });
                    }}
                  >
                    <Trash2 size={18} strokeWidth={2} />
                  </button>
                </>
              );
            })()}

            {(() => {
              const selectedList = messages.filter((m) =>
                selectedMessageIds.has(m.id)
              );
              const canForward =
                selectedList.length > 0 &&
                selectedList.every((m) => !m.deletedForEveryone);
              if (!canForward) return null;
              return (
                <button
                  type="button"
                  className="header-action-btn forward-header-btn"
                  aria-label="Forward selected"
                  title="Forward"
                  onClick={() => setShowForwardModal(true)}
                >
                  <CornerUpRight size={18} strokeWidth={2.2} />
                  <span className="forward-btn-label">Forward</span>
                </button>
              );
            })()}
          </div>
        </div>
      ) : (
        <div className="chat-window-header">
          <button
            type="button"
            className="back-btn"
            aria-label="Back to conversations"
            onClick={onBack}
          >
            <ArrowLeft size={20} strokeWidth={2} />
          </button>

          <span
            className="avatar"
            aria-hidden="true"
          >
            {conversation.otherUser.avatarUrl ? (
              <img
                src={conversation.otherUser.avatarUrl}
                alt=""
                className="avatar-image"
              />
            ) : (
              conversation.otherUser.username
                .slice(0, 1)
                .toUpperCase()
            )}
          </span>

          <div className="chat-title">
            <strong>
              <span className="chat-title-username">
                {conversation.otherUser.username}
              </span>
              {conversation.otherUser.isVerified && <VerifiedBadge size={17} />}
            </strong>

            <HeaderStatus
              status={conversationStatus}
            />
          </div>
        </div>
      )}

      <div className="message-scroll-region">
      <div
        className="message-list"
        ref={listRef}
        onScroll={handleScroll}
      >
        {loadingNewer && <div className="load-older">Loading newer messages…</div>}
        {loadingOlder && (
          <div className="load-older">
            Loading older messages…
          </div>
        )}

        {loading && messages.length === 0 && (
          <div className="empty-state">
            Loading…
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="empty-state">
            No messages yet. Say hello to @
            {conversation.otherUser.username}
          </div>
        )}

        {messages.map((m, i) => {
          const prev = messages[i - 1];

          const showDivider =
            !prev ||
            !isSameDay(
              prev.createdAt,
              m.createdAt
            );

          return (
            <div key={m.clientId ?? m.id} data-message-id={m.id} className={highlightedMessageId === m.id ? "message-highlighted" : undefined}>
              {showDivider && (
                <div className="day-divider">
                  {formatDayDivider(
                    m.createdAt
                  )}
                </div>
              )}

              <MessageBubble
                message={m}
                conversationId={conversation.id}
                isOwn={
                  m.senderId === currentUser.id
                }
                isSelected={selectedMessageIds.has(m.id)}
                isSelectionMode={isSelectionMode}
                onToggleSelect={handleToggleSelect}
                onLongPress={handleLongPress}
                onOpenMenu={handleOpenMenu}
                onRetry={() =>
                  retryMessage(
                    m.clientId,
                    m.content ?? "",
                    m.replyToMessageId
                  )
                }
                onReply={() => setReplyingTo(makeReplyPreview(m))}
                onForward={() => {
                  setSelectedMessageIds(new Set([m.id]));
                  setShowForwardModal(true);
                }}
                onJumpToReply={jumpToMessage}
                senderUsername={m.senderId === currentUser.id ? currentUser.username : conversation.otherUser.username}
              />
            </div>
          );
        })}
      </div>
      {(isAwayFromBottom || newMessageCount > 0) && (
        <button
          type="button"
          className="go-to-latest"
          aria-label={newMessageCount ? `Go to latest, ${newMessageCount} new ${newMessageCount === 1 ? "message" : "messages"}` : "Go to latest messages"}
          onClick={() => void goToLatest()}
        >
          <ArrowDown size={17} strokeWidth={2.2} />
          {newMessageCount > 0 ? `${newMessageCount} new ${newMessageCount === 1 ? "message" : "messages"}` : "Latest"}
        </button>
      )}
      </div>

      <MessageInput
        conversationId={conversation.id}
        onSend={sendMessage}
        onSendVoice={sendVoiceMessage}
        onMediaSent={handleMediaSent}
        onError={onError}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
      />

      {contextMenu && (
        <>
          <div
            className="message-context-menu-backdrop"
            onClick={() => setContextMenu(null)}
          />
          <div
            className="message-context-menu"
            style={(() => {
              const menuWidth = 160;
              const menuHeight = 140;
              const vw = typeof window !== "undefined" ? window.innerWidth : 400;
              const vh = typeof window !== "undefined" ? window.innerHeight : 800;

              let top = contextMenu.y;
              let left = contextMenu.x;

              if (contextMenu.rect) {
                if (contextMenu.rect.top > menuHeight + 20) {
                  top = contextMenu.rect.top - menuHeight - 6;
                } else {
                  top = contextMenu.rect.bottom + 6;
                }
                left = Math.min(contextMenu.rect.left, vw - menuWidth - 12);
              } else {
                if (top + menuHeight > vh - 12) {
                  top = Math.max(12, top - menuHeight);
                }
                if (left + menuWidth > vw - 12) {
                  left = Math.max(12, left - menuWidth);
                }
              }

              left = Math.max(12, Math.min(left, vw - menuWidth - 12));
              top = Math.max(12, Math.min(top, vh - menuHeight - 12));

              return { top, left };
            })()}
            role="menu"
          >
            {contextMenu.message.status === "sent" &&
              !contextMenu.message.deletedForEveryone && (
                <button
                  type="button"
                  className="context-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setReplyingTo(makeReplyPreview(contextMenu.message));
                    setContextMenu(null);
                    clearSelection();
                  }}
                >
                  <Reply size={16} strokeWidth={2} />
                  <span>Reply</span>
                </button>
              )}

            {!contextMenu.message.deletedForEveryone && (
              <button
                type="button"
                className="context-menu-item"
                role="menuitem"
                onClick={() => {
                  setSelectedMessageIds(new Set([contextMenu.message.id]));
                  setContextMenu(null);
                }}
              >
                <CornerUpRight size={16} strokeWidth={2} />
                <span>Forward</span>
              </button>
            )}

            {!contextMenu.message.deletedForEveryone &&
              Boolean(contextMenu.message.content?.trim()) && (
                <button
                  type="button"
                  className="context-menu-item"
                  role="menuitem"
                  onClick={() => {
                    void handleCopyText(contextMenu.message.content!);
                    setContextMenu(null);
                    clearSelection();
                  }}
                >
                  <Copy size={16} strokeWidth={2} />
                  <span>Copy</span>
                </button>
              )}

            <button
              type="button"
              className="context-menu-item context-menu-item-danger"
              role="menuitem"
              onClick={() => {
                const msg = contextMenu.message;
                const canDeleteForEveryone =
                  !msg.deletedForEveryone &&
                  msg.senderId === currentUser.id &&
                  msg.status === "sent";
                setDeleteModal({
                  messageIds: [msg.id],
                  canDeleteForEveryone,
                });
                setContextMenu(null);
              }}
            >
              <Trash2 size={16} strokeWidth={2} />
              <span>Delete</span>
            </button>
          </div>
        </>
      )}

      {showForwardModal && (
        <ForwardModal
          selectedMessages={messages.filter((m) => selectedMessageIds.has(m.id))}
          currentConversationId={conversation.id}
          onClose={() => setShowForwardModal(false)}
          onForwardSuccess={(targetConvIds) => {
            clearSelection();
            setShowForwardModal(false);
            setToast("Messages forwarded");
            if (targetConvIds.includes(conversation.id)) {
              void apiLoadNewMessages(conversation.id, lastKnownIdRef.current).then(
                ({ messages: newMsgs }) => {
                  if (newMsgs?.length) {
                    setMessages((prev) =>
                      sortMessagesChronologically([
                        ...prev,
                        ...newMsgs.map((nm) => ({ ...nm, status: "sent" as const })),
                      ])
                    );
                    requestAnimationFrame(() => scrollToBottom("smooth"));
                  }
                }
              );
            }
          }}
          onError={onError}
        />
      )}

      {deleteModal && (
        <>
          <div
            className="delete-modal-backdrop"
            onClick={() => setDeleteModal(null)}
          />
          <div className="delete-modal-card" role="dialog" aria-modal="true">
            <p className="delete-modal-title">
              {deleteModal.messageIds.length > 1
                ? `Delete ${deleteModal.messageIds.length} messages?`
                : "Delete message?"}
            </p>
            {deleteModal.canDeleteForEveryone && (
              <button
                type="button"
                className="delete-modal-btn delete-modal-btn-danger"
                onClick={() =>
                  handleDeleteMessages(deleteModal.messageIds, "everyone")
                }
              >
                Delete for everyone
              </button>
            )}
            <button
              type="button"
              className="delete-modal-btn"
              onClick={() =>
                handleDeleteMessages(deleteModal.messageIds, "me")
              }
            >
              Delete for me
            </button>
            <button
              type="button"
              className="delete-modal-btn delete-modal-btn-cancel"
              onClick={() => setDeleteModal(null)}
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {undoDelete && (
        <div className="toast undo-toast" role="status">
          <span>
            {undoDelete.messages.length === 1
              ? "Message deleted"
              : `${undoDelete.messages.length} messages deleted`}
          </span>
          <button
            type="button"
            className="undo-toast-btn"
            onClick={() => void handleUndoDelete()}
          >
            Undo
          </button>
        </div>
      )}

      {toast && !undoDelete && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function HeaderStatus({
  status,
}: {
  status: ApiConversationStatus | null;
}) {
  if (!status) {
    return (
      <span className="chat-status-line" aria-hidden="true">
        &nbsp;
      </span>
    );
  }

  const raw = status as any;
  const isRecording =
    status.composerState === "recording" ||
    raw.state === "recording" ||
    raw.recording === true ||
    raw.isRecording === true ||
    Boolean(raw.recordingUserId);

  const isTyping =
    !isRecording &&
    (status.composerState === "typing" ||
      raw.state === "typing" ||
      raw.typing === true ||
      raw.isTyping === true ||
      Boolean(raw.typingUserId));

  if (isRecording) {
    return (
      <span
        className="chat-status-line recording"
        aria-label="Recording voice message"
      >
        <span
          className="remote-recording-dot"
          aria-hidden="true"
        />
        Recording...
      </span>
    );
  }

  if (isTyping) {
    return (
      <span
        className="chat-status-line"
        aria-label="Typing"
      >
        <span className="typing-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        typing...
      </span>
    );
  }

  if (!status.presence.visible) {
    return (
      <span className="chat-status-line" aria-hidden="true">
        &nbsp;
      </span>
    );
  }

  if (status.presence.online) {
    return (
      <span className="chat-status-line online">
        online
      </span>
    );
  }

  if (status.presence.lastSeenAt) {
    return (
      <span className="chat-status-line">
        {formatLastSeen(status.presence.lastSeenAt)}
      </span>
    );
  }

  return (
    <span className="chat-status-line" aria-hidden="true">
      &nbsp;
    </span>
  );
}

function formatLastSeen(ts: number): string {
  const now = Date.now();
  const diffMs = Math.max(0, now - ts);
  const diffMins = Math.floor(diffMs / 60_000);

  if (diffMins < 1) {
    return "last seen just now";
  }

  if (diffMins < 60) {
    return `last seen ${diffMins} ${diffMins === 1 ? "minute" : "minutes"} ago`;
  }

  const date = new Date(ts);
  const nowDate = new Date(now);
  const time = formatClockTime(date);

  if (isSameDay(ts, now)) {
    return `last seen today at ${time}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(nowDate.getDate() - 1);

  if (isSameDay(ts, yesterday.getTime())) {
    return `last seen yesterday at ${time}`;
  }

  const day = date.getDate();
  const month = date.toLocaleDateString("en-US", { month: "short" });
  const year = date.getFullYear();

  return `last seen on ${day} ${month} ${year} at ${time}`;
}

function isSameDay(
  a: number,
  b: number
): boolean {
  const da = new Date(a);
  const db = new Date(b);

  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function formatDayDivider(
  ts: number
): string {
  const date = new Date(ts);
  const now = new Date();

  if (isSameDay(ts, now.getTime())) {
    return "Today";
  }

  const yesterday = new Date(now);

  yesterday.setDate(
    now.getDate() - 1
  );

  if (
    isSameDay(
      ts,
      yesterday.getTime()
    )
  ) {
    return "Yesterday";
  }

  return date.toLocaleDateString(
    undefined,
    {
      month: "short",
      day: "numeric",
      year:
        date.getFullYear() !==
        now.getFullYear()
          ? "numeric"
          : undefined,
    }
  );
}
