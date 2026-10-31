"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";

const NOTIFICATION_PROMPT_KEY = "messenger_notification_prompt";

export default function NotificationPermissionModal() {
  const [visible, setVisible] = useState(false);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Browser does not support notifications.
    if (!("Notification" in window)) return;

    // Already granted/denied by the browser.
    if (Notification.permission !== "default") return;

    // We have already asked this user once.
    if (localStorage.getItem(NOTIFICATION_PROMPT_KEY)) return;

    setVisible(true);
  }, []);

  function rememberChoice() {
    localStorage.setItem(NOTIFICATION_PROMPT_KEY, "1");
  }

  async function handleYes() {
    if (!("Notification" in window)) {
      rememberChoice();
      setVisible(false);
      return;
    }

    setRequesting(true);

    try {
      await Notification.requestPermission();
    } finally {
      rememberChoice();
      setRequesting(false);
      setVisible(false);
    }
  }

  function handleNo() {
    rememberChoice();
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !requesting) {
          handleNo();
        }
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        background: "rgba(0, 0, 0, 0.45)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-dialog-title"
        aria-describedby="notification-dialog-description"
        style={{
          width: "100%",
          maxWidth: "420px",
          padding: "24px",
          borderRadius: "18px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.25)",
        }}
      >
        <div
          style={{
            width: "48px",
            height: "48px",
            marginBottom: "16px",
            borderRadius: "14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--surface-muted, rgba(127, 127, 127, 0.12))",
            color: "var(--accent, #3b82f6)",
          }}
          aria-hidden="true"
        >
          <Bell size={24} strokeWidth={2} />
        </div>

        <h2
          id="notification-dialog-title"
          style={{
            margin: "0 0 8px",
            fontSize: "20px",
            fontWeight: 700,
            color: "var(--text)",
          }}
        >
          Turn on notifications?
        </h2>

        <p
          id="notification-dialog-description"
          style={{
            margin: "0",
            lineHeight: 1.55,
            color: "var(--text-muted)",
            fontSize: "14px",
          }}
        >
          Get notified when someone sends you a new message.
        </p>

        <div
          style={{
            display: "flex",
            gap: "10px",
            justifyContent: "flex-end",
            marginTop: "24px",
          }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleNo}
            disabled={requesting}
            style={{
              minWidth: "90px",
            }}
          >
            No
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleYes}
            disabled={requesting}
            style={{
              minWidth: "90px",
            }}
          >
            {requesting ? "Please wait…" : "Yes"}
          </button>
        </div>
      </div>
    </div>
  );
}