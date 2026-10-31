"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  apiAcknowledgeDelivery,
  apiHeartbeatPresence,
  apiListConversations,
  apiLogout,
  apiOpenConversation,
  type ApiConversation,
  type ApiUser,
} from "@/lib/client/api";
import { Plus } from "lucide-react";
import Header from "@/components/Header";
import ChatList from "@/components/ChatList";
import ChatWindow from "@/components/ChatWindow";
import NewConversationModal from "@/components/NewConversationModal";
import NotificationPermissionModal from "@/components/NotificationPermissionModal";

const CONVERSATIONS_POLL_MS = 20_000;
const DELIVERY_POLL_MS = 3_000;
const PRESENCE_HEARTBEAT_MS = 10_000;

export type SelectedConversation = {
  id: string;
  otherUser: ApiUser;
};

export default function ChatApp({
  currentUser,
}: {
  currentUser: ApiUser;
}) {
  const router = useRouter();
  const [conversations, setConversations] = useState<
    ApiConversation[]
  >([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] =
    useState<SelectedConversation | null>(null);
  const [showNewChat, setShowNewChat] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const selectedRef =
    useRef<SelectedConversation | null>(null);

  selectedRef.current = selected;

  const presenceIdRef = useRef<string | null>(null);
  if (!presenceIdRef.current) {
    presenceIdRef.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  useEffect(() => {
    if (!toast) return;

    const timer = setTimeout(
      () => setToast(null),
      4000
    );

    return () => clearTimeout(timer);
  }, [toast]);

  // Android Chrome can leave the layout viewport at its full height while
  // the keyboard shrinks only the visual viewport. Keep the app's flex
  // viewport tied to that visible area without causing React renders.
  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 767px)");
    const isTouchDevice = () =>
      navigator.maxTouchPoints > 0 || "ontouchstart" in window;
    const visualViewport = window.visualViewport;
    if (!visualViewport) return;

    let lastHeight = -1;
    let lastKeyboardGap = -1;
    let lastUnfocusedHeight = Math.round(visualViewport.height);
    const root = document.documentElement;

    const syncViewport = () => {
      if (!mobileQuery.matches || !isTouchDevice()) {
        root.style.removeProperty("--chat-viewport-height");
        root.style.removeProperty("--chat-keyboard-gap");
        return;
      }

      const height = Math.round(visualViewport.height);
      const inputFocused =
        document.activeElement instanceof HTMLTextAreaElement ||
        document.activeElement instanceof HTMLInputElement;
      if (!inputFocused) lastUnfocusedHeight = height;
      const keyboardOpen =
        inputFocused && lastUnfocusedHeight - height > 120;
      const keyboardGap = keyboardOpen ? 12 : 0;

      if (height !== lastHeight) {
        root.style.setProperty("--chat-viewport-height", `${height}px`);
        lastHeight = height;
      }
      if (keyboardGap !== lastKeyboardGap) {
        root.style.setProperty("--chat-keyboard-gap", `${keyboardGap}px`);
        lastKeyboardGap = keyboardGap;
      }
    };

    syncViewport();
    visualViewport.addEventListener("resize", syncViewport);
    visualViewport.addEventListener("scroll", syncViewport);
    window.addEventListener("resize", syncViewport);
    document.addEventListener("focusin", syncViewport);
    document.addEventListener("focusout", syncViewport);
    mobileQuery.addEventListener("change", syncViewport);

    return () => {
      visualViewport.removeEventListener("resize", syncViewport);
      visualViewport.removeEventListener("scroll", syncViewport);
      window.removeEventListener("resize", syncViewport);
      document.removeEventListener("focusin", syncViewport);
      document.removeEventListener("focusout", syncViewport);
      mobileQuery.removeEventListener("change", syncViewport);
      root.style.removeProperty("--chat-viewport-height");
      root.style.removeProperty("--chat-keyboard-gap");
    };
  }, []);

  const refreshConversations = useCallback(async () => {
    try {
      const { conversations: list } =
        await apiListConversations();

      setConversations(list);
    } catch {
      // Silent — the list will retry on the next poll/interaction.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  useEffect(() => {
    const presenceId = presenceIdRef.current!;

    let interval: ReturnType<typeof setInterval> | null =
      null;

    async function heartbeat() {
      try {
        await apiHeartbeatPresence(presenceId, selectedRef.current?.id ?? null);
      } catch {
        // Presence is best-effort and should not interrupt chat.
      }
    }

    function start() {
      if (interval) return;

      heartbeat();

      interval = setInterval(
        heartbeat,
        PRESENCE_HEARTBEAT_MS
      );
    }

    function stop() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    }

    function onVisibility() {
      if (document.visibilityState === "visible") {
        start();
      } else {
        stop();
        // Clear active conversation immediately when app is hidden / minimized
        apiHeartbeatPresence(presenceId, null).catch(() => {});
      }
    }

    if (document.visibilityState === "visible") {
      start();
    }

    document.addEventListener(
      "visibilitychange",
      onVisibility
    );

    return () => {
      stop();

      document.removeEventListener(
        "visibilitychange",
        onVisibility
      );
    };
  }, []);

  // Update active conversation presence immediately when conversation changes
  useEffect(() => {
    if (!presenceIdRef.current || document.visibilityState !== "visible") return;
    apiHeartbeatPresence(presenceIdRef.current, selected?.id ?? null).catch(() => {});
  }, [selected?.id]);

  // Light periodic refresh of the conversation list
  // (previews / unread state), paused while the tab is hidden.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null =
      null;

    function start() {
      if (interval) return;

      interval = setInterval(
        refreshConversations,
        CONVERSATIONS_POLL_MS
      );
    }

    function stop() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    }

    function onVisibility() {
      if (
        document.visibilityState === "visible"
      ) {
        refreshConversations();
        start();
      } else {
        stop();
      }
    }

    if (
      document.visibilityState === "visible"
    ) {
      start();
    }

    document.addEventListener(
      "visibilitychange",
      onVisibility
    );

    return () => {
      stop();

      document.removeEventListener(
        "visibilitychange",
        onVisibility
      );
    };
  }, [refreshConversations]);

  // Acknowledge incoming messages as delivered even when the
  // conversation itself is not currently open.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null =
      null;

    async function acknowledgeDelivery() {
      try {
        await apiAcknowledgeDelivery();
      } catch {
        // Silent — the next poll will retry.
      }
    }

    function start() {
      if (interval) return;

      // Do one immediately when the app becomes active.
      acknowledgeDelivery();

      interval = setInterval(
        acknowledgeDelivery,
        DELIVERY_POLL_MS
      );
    }

    function stop() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    }

    function onVisibility() {
      if (
        document.visibilityState === "visible"
      ) {
        start();
      } else {
        stop();
      }
    }

    if (
      document.visibilityState === "visible"
    ) {
      start();
    }

    document.addEventListener(
      "visibilitychange",
      onVisibility
    );

    return () => {
      stop();

      document.removeEventListener(
        "visibilitychange",
        onVisibility
      );
    };
  }, []);

  const handleSelect = useCallback(
    (conv: SelectedConversation) => {
      const isMobile =
        window.matchMedia(
          "(max-width: 767px)"
        ).matches;

      if (isMobile) {
        if (selectedRef.current) {
          // Already inside a chat — don't create another
          // browser-history entry just because the user
          // switched conversations.
          window.history.replaceState(
            {
              ...window.history.state,
              messengerView: "chat",
            },
            "",
            window.location.href
          );
        } else {
          // Main menu -> chat: create one history entry.
          window.history.pushState(
            {
              ...window.history.state,
              messengerView: "chat",
            },
            "",
            window.location.href
          );
        }
      }

      setSelected(conv);

      setConversations((prev) =>
        prev.map((c) =>
          c.id === conv.id
            ? {
                ...c,
                unread: false,
              }
            : c
        )
      );
    },
    []
  );

  const handleBack = useCallback(() => {
    setSelected(null);
  }, []);

  // On mobile, keep the first browser/Android Back press
  // inside the messaging app: Chat -> conversation list.
  // A second Back press then leaves the /chat page normally.
  useEffect(() => {
    const isMobile = () =>
      window.matchMedia(
        "(max-width: 767px)"
      ).matches;

    // Mark the current history entry as the
    // conversation-list state.
    window.history.replaceState(
      {
        ...window.history.state,
        messengerView: "list",
      },
      "",
      window.location.href
    );

    function handlePopState() {
      if (!isMobile()) return;

      // Browser/Android Back returned to the list state.
      // Do not navigate away from /chat.
      setSelected(null);
    }

    window.addEventListener(
      "popstate",
      handlePopState
    );

    return () => {
      window.removeEventListener(
        "popstate",
        handlePopState
      );
    };
  }, []);

  const handleStartConversation =
    useCallback(
      async (username: string) => {
        const { conversation } =
          await apiOpenConversation(username);

        setShowNewChat(false);

        setConversations((prev) => {
          if (
            prev.some(
              (c) => c.id === conversation.id
            )
          ) {
            return prev;
          }

          return [
            {
              id: conversation.id,
              otherUser:
                conversation.otherUser,
              lastMessage: null,
              lastMessageAt: null,
              lastMessageFromMe: false,
              unread: false,
            },
            ...prev,
          ];
        });

        const nextConversation = {
          id: conversation.id,
          otherUser: conversation.otherUser,
        };

        if (
          window.matchMedia(
            "(max-width: 767px)"
          ).matches
        ) {
          window.history.pushState(
            {
              ...window.history.state,
              messengerView: "chat",
            },
            "",
            window.location.href
          );
        }

        setSelected(nextConversation);
      },
      []
    );

  const handleMessageSent = useCallback(
    (
      conversationId: string,
      content: string,
      createdAt: number
    ) => {
      setConversations((prev) => {
        const next = prev.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                lastMessage: content,
                lastMessageAt: createdAt,
                lastMessageFromMe: true,
                unread: false,
              }
            : c
        );

        return next.sort(
          (a, b) =>
            (b.lastMessageAt ?? 0) -
            (a.lastMessageAt ?? 0)
        );
      });
    },
    []
  );

  const handleIncomingMessage = useCallback(
    (
      conversationId: string,
      content: string,
      createdAt: number,
      fromMe: boolean
    ) => {
      setConversations((prev) => {
        const next = prev.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                lastMessage: content,
                lastMessageAt: createdAt,
                lastMessageFromMe: fromMe,
                unread:
                  !fromMe &&
                  selectedRef.current?.id !==
                    conversationId,
              }
            : c
        );

        return next.sort(
          (a, b) =>
            (b.lastMessageAt ?? 0) -
            (a.lastMessageAt ?? 0)
        );
      });
    },
    []
  );

  const handleLogout = useCallback(
    async () => {
      try {
        await apiLogout();
      } catch {
        // fall through — redirect regardless
      }

      router.replace("/login");
      router.refresh();
    },
    [router]
  );

  return (
    <div className="chat-shell">
      <Header
        username={currentUser.username}
        avatarUrl={currentUser.avatarUrl}
        isVerified={currentUser.isVerified}
        onNewChat={() =>
          setShowNewChat(true)
        }
      />

      <div
        className="chat-body"
        data-view={
          selected ? "chat" : "list"
        }
      >
        <div className="conversation-panel">
          <div className="conversation-search">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                setShowNewChat(true)
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <Plus size={16} strokeWidth={2} />
              New conversation
            </button>
          </div>

          <ChatList
            conversations={conversations}
            loaded={loaded}
            selectedId={
              selected?.id ?? null
            }
            onSelect={handleSelect}
          />
        </div>

        <ChatWindow
          currentUser={currentUser}
          conversation={selected}
          onBack={handleBack}
          onMessageSent={
            handleMessageSent
          }
          onIncomingMessage={
            handleIncomingMessage
          }
          onError={setToast}
        />
      </div>

      {showNewChat && (
        <NewConversationModal
          onClose={() =>
            setShowNewChat(false)
          }
          onOpenConversation={
            handleStartConversation
          }
        />
      )}

            <NotificationPermissionModal />

      {toast && (
        <div
          className="toast"
          role="status"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
