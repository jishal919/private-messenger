"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@imagekit/javascript";
import ThemeToggle from "@/components/ThemeToggle";
import VerifiedBadge from "@/components/VerifiedBadge";
import { AlertTriangle, ArrowLeft, LogOut, Trash2 } from "lucide-react";

import {
  apiGetProfileSettings,
  apiUpdateReadReceipts,
  apiUpdateNotifications,
  apiUpdateShowLastSeen,
  apiUpdateUsername,
  apiUpdateAvatar,
  apiRemoveAvatar,
  apiDeleteAccount,
  apiLogout,
  ApiError,
  type ApiUser,
} from "@/lib/client/api";

import {
  apiSavePushSubscription,
  apiDeletePushSubscription,
} from "@/lib/client/api";

import {
  subscribeToPush,
  getPushSubscription,
  unsubscribeFromPush,
} from "@/lib/client/notifications";

export default function ProfilePage() {
  const router = useRouter();

  const [user, setUser] = useState<ApiUser | null>(null);
  const [loading, setLoading] = useState(true);

  const [showAvatarActions, setShowAvatarActions] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const [editingUsername, setEditingUsername] = useState(false);
  const [username, setUsername] = useState("");
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [readReceiptsEnabled, setReadReceiptsEnabled] = useState(true);
  const [savingReadReceipts, setSavingReadReceipts] = useState(false);

  const [notificationsEnabled, setNotificationsEnabled] =
    useState(false);
  const [savingNotifications, setSavingNotifications] =
    useState(false);
  const [showLastSeenEnabled, setShowLastSeenEnabled] =
    useState(true);
  const [savingShowLastSeen, setSavingShowLastSeen] =
    useState(false);

  const [deletingAccount, setDeletingAccount] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const [showDeleteAccountModal, setShowDeleteAccountModal] =
    useState(false);

  const MAX_AVATAR_SIZE = 15 * 1024 * 1024;

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      try {
        const response = await fetch("/api/auth/me", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });

        if (!response.ok) {
          if (response.status === 401) {
            router.replace("/login");
            return;
          }

          throw new Error("Failed to load profile.");
        }

        const data = (await response.json()) as {
          user: ApiUser;
        };

        if (cancelled) {
          return;
        }

        setUser(data.user);
        setUsername(data.user.username);
        setAvatarUrl(data.user.avatarUrl ?? null);

        try {
          const settingsResponse = await apiGetProfileSettings();

          if (!cancelled) {
            setReadReceiptsEnabled(
              settingsResponse.settings.readReceiptsEnabled
            );

            setNotificationsEnabled(
              settingsResponse.settings.notificationsEnabled
            );

            setShowLastSeenEnabled(
              settingsResponse.settings.showLastSeenEnabled
            );
          }
        } catch {
          // Keep the default enabled state if settings
          // cannot be loaded.
        }
      } catch {
        if (!cancelled) {
          router.replace("/chat");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadProfile();

    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleAvatarChange(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];

    // Allow selecting the same file again later.
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setError("Please select an image file.");
      return;
    }

    if (file.size > MAX_AVATAR_SIZE) {
      setError("Profile picture must be 15 MB or smaller.");
      return;
    }

    if (!user) {
      return;
    }

    setAvatarUploading(true);
    setError(null);

    try {
      const authResponse = await fetch("/api/profile/avatar/auth", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      const authData = (await authResponse.json()) as {
        token?: string;
        expire?: number;
        signature?: string;
        publicKey?: string;
        error?: string;
      };

      if (!authResponse.ok) {
        throw new Error(
          authData.error ?? "Could not initialize image upload."
        );
      }

      if (
        !authData.token ||
        !authData.expire ||
        !authData.signature ||
        !authData.publicKey
      ) {
        throw new Error("Invalid image upload configuration.");
      }

      const extension =
        file.name.includes(".")
          ? `.${file.name.split(".").pop()}`
          : "";

      const uniqueFileName = `profile-${crypto.randomUUID()}${extension}`;

      const uploadResult = await upload({
        file,
        fileName: uniqueFileName,
        publicKey: authData.publicKey,
        token: authData.token,
        signature: authData.signature,
        expire: authData.expire,
        folder: `/users/${user.id}/avatar`,
        useUniqueFileName: false,
      });

      

      if (!uploadResult.filePath) {
        throw new Error("Image upload did not return a file path.");
      }

      const avatarKey = uploadResult.filePath.replace(/^\/+/, "");

      if (!uploadResult.fileId) {
        throw new Error(
          "Image upload succeeded, but no file ID was returned."
        );
      }

      await apiUpdateAvatar(
        avatarKey,
        uploadResult.fileId
      );

      if (uploadResult.url) {
        setAvatarUrl(uploadResult.url);

        setUser((previous) =>
          previous
            ? {
                ...previous,
                avatarUrl: uploadResult.url,
              }
            : previous
        );
      }

      setShowAvatarActions(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not upload profile picture."
      );
    } finally {
      setAvatarUploading(false);
    }
  }

  async function handleRemoveAvatar() {
    setAvatarUploading(true);
    setError(null);

    try {
      await apiRemoveAvatar();

      setAvatarUrl(null);

      setUser((previous) =>
        previous
          ? {
              ...previous,
              avatarUrl: null,
            }
          : previous
      );

      setShowAvatarActions(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not remove profile picture."
      );
    } finally {
      setAvatarUploading(false);
    }
  }

  async function saveUsername() {
    const trimmed = username.trim();

    if (!trimmed) {
      setError("Username cannot be empty.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const { user: updatedUser } = await apiUpdateUsername(trimmed);

      setUser(updatedUser);
      setUsername(updatedUser.username);
      setEditingUsername(false);

      /*
       * ChatApp receives the username from the authenticated
       * user on the server, so reload /chat after changing it.
       */
      router.replace("/chat");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not update username."
      );
    } finally {
      setSaving(false);
    }
  }

  function cancelEditing() {
    if (user) {
      setUsername(user.username);
    }

    setError(null);
    setEditingUsername(false);
  }

  async function toggleReadReceipts() {
    const nextValue = !readReceiptsEnabled;

    /*
     * Optimistic UI: change the switch immediately.
     * If the server rejects the update, restore the
     * previous value.
     */
    setReadReceiptsEnabled(nextValue);
    setSavingReadReceipts(true);
    setError(null);

    try {
      await apiUpdateReadReceipts(nextValue);
    } catch (err) {
      setReadReceiptsEnabled(!nextValue);

      setError(
        err instanceof ApiError
          ? err.message
          : "Could not update read receipt setting."
      );
    } finally {
      setSavingReadReceipts(false);
    }
  }

  async function toggleNotifications() {
    const nextValue = !notificationsEnabled;

    if (
      typeof window === "undefined" ||
      !("Notification" in window)
    ) {
      setError(
        "This browser does not support notifications."
      );
      return;
    }

    if (nextValue) {
      if (Notification.permission === "denied") {
        setError(
          "Notifications are blocked by your browser. Allow notifications in your browser settings, then try again."
        );
        return;
      }

      setSavingNotifications(true);
      setError(null);

      try {
        if (Notification.permission === "default") {
          const permission =
            await Notification.requestPermission();

          if (permission !== "granted") {
            setNotificationsEnabled(false);
            return;
          }
        }

        const subscription =
          await subscribeToPush();

        await apiSavePushSubscription(
          subscription.toJSON() as {
            endpoint: string;
            keys: {
              p256dh: string;
              auth: string;
            };
          }
        );

        await apiUpdateNotifications(true);

        setNotificationsEnabled(true);
      } catch (err) {
        setNotificationsEnabled(false);

        setError(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Could not enable notifications."
        );
      } finally {
        setSavingNotifications(false);
      }

      return;
    }

    setSavingNotifications(true);
    setError(null);

    try {
      const subscription =
        await getPushSubscription();

      if (subscription) {
        const endpoint = subscription.endpoint;

        await unsubscribeFromPush();

        await apiDeletePushSubscription(
          endpoint
        );
      }

      await apiUpdateNotifications(false);

      setNotificationsEnabled(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not disable notifications."
      );
    } finally {
      setSavingNotifications(false);
    }
  }

  async function toggleShowLastSeen() {
    const nextValue = !showLastSeenEnabled;

    setShowLastSeenEnabled(nextValue);
    setSavingShowLastSeen(true);
    setError(null);

    try {
      await apiUpdateShowLastSeen(nextValue);
    } catch (err) {
      setShowLastSeenEnabled(!nextValue);

      setError(
        err instanceof ApiError
          ? err.message
          : "Could not update presence setting."
      );
    } finally {
      setSavingShowLastSeen(false);
    }
  }


  async function deleteAccount() {
  setDeletingAccount(true);
  setError(null);

  try {
    await apiDeleteAccount();

    router.replace("/login");
    router.refresh();
  } catch (err) {
    setError(
      err instanceof ApiError
        ? err.message
        : "Could not delete your account."
    );

    setDeletingAccount(false);
    setShowDeleteAccountModal(false);
  }
}

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await apiLogout();
    } catch {
      // fall through — redirect regardless
    }
    router.replace("/login");
    router.refresh();
  }

  if (loading) {
    return (
      <main className="profile-page">
        <div className="profile-header">
          <button
            type="button"
            className="icon-btn"
            aria-label="Back"
            title="Back"
            onClick={() => router.back()}
          >
            <ArrowLeft size={20} strokeWidth={2} />
          </button>

          <h1>Profile</h1>
        </div>

        <section className="profile-card">
          <div className="empty-state">Loading…</div>
        </section>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  const displayedAvatarUrl = avatarUrl || user.avatarUrl || null;

  return (
    <main className="profile-page">
      <div className="profile-header">
        <button
          type="button"
          className="icon-btn"
          aria-label="Back"
          title="Back"
          onClick={() => router.back()}
        >
          <ArrowLeft size={20} strokeWidth={2} />
        </button>

        <h1>Profile</h1>
      </div>

      <section className="profile-card">
        {/* Avatar */}
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          onChange={handleAvatarChange}
          hidden
        />

        <button
          type="button"
          className="profile-avatar"
          aria-label={
            displayedAvatarUrl
              ? "Change or remove profile picture"
              : "Add profile picture"
          }
          title={
            displayedAvatarUrl
              ? "Change or remove profile picture"
              : "Add profile picture"
          }
          onClick={() => setShowAvatarActions(true)}
          disabled={avatarUploading}
        >
          {displayedAvatarUrl ? (
            <img
              src={displayedAvatarUrl}
              alt="Profile picture"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                borderRadius: "50%",
                display: "block",
              }}
            />
          ) : (
            user.username.charAt(0).toUpperCase()
          )}
        </button>

        {avatarUploading && (
          <div
            style={{
              marginTop: 8,
              textAlign: "center",
              fontSize: 13,
              color: "var(--text-muted)",
            }}
          >
            Updating profile picture…
          </div>
        )}

        {/* Avatar action sheet */}
        {showAvatarActions && (
          <div
            className="avatar-action-overlay"
            role="presentation"
            onClick={() => {
              if (!avatarUploading) {
                setShowAvatarActions(false);
              }
            }}
          >
            <div
              className="avatar-action-sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby="avatar-action-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="avatar-action-handle" />

              <h2 id="avatar-action-title">
                Profile photo
              </h2>

              <button
                type="button"
                className="avatar-action-button"
                onClick={() => {
                  setShowAvatarActions(false);

                  requestAnimationFrame(() => {
                    avatarInputRef.current?.click();
                  });
                }}
                disabled={avatarUploading}
              >
                Change profile photo
              </button>

              {displayedAvatarUrl && (
                <button
                  type="button"
                  className="avatar-action-button avatar-action-danger"
                  onClick={handleRemoveAvatar}
                  disabled={avatarUploading}
                >
                  {avatarUploading
                    ? "Removing…"
                    : "Remove profile photo"}
                </button>
              )}

              <button
                type="button"
                className="avatar-action-button avatar-action-cancel"
                onClick={() => setShowAvatarActions(false)}
                disabled={avatarUploading}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Username */}
        {!editingUsername ? (
          <>
            <div className="profile-username">
              {user.username}
              {user.isVerified && <VerifiedBadge size={19} />}
            </div>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setError(null);
                setEditingUsername(true);
              }}
              style={{ marginTop: 16 }}
            >
              Edit username
            </button>
          </>
        ) : (
          <div
            style={{
              width: "100%",
              maxWidth: 360,
              margin: "0 auto",
            }}
          >
            <label
              htmlFor="profile-username"
              style={{
                display: "block",
                textAlign: "left",
                marginBottom: 6,
                fontSize: 13,
                color: "var(--text-muted)",
              }}
            >
              Username
            </label>

            <input
              id="profile-username"
              type="text"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();

                  if (!saving) {
                    saveUsername();
                  }
                }

                if (event.key === "Escape") {
                  event.preventDefault();

                  if (!saving) {
                    cancelEditing();
                  }
                }
              }}
              autoFocus
              autoComplete="username"
              disabled={saving}
              style={{
                width: "100%",
                boxSizing: "border-box",
              }}
            />

            {error && (
              <div
                role="alert"
                style={{
                  marginTop: 8,
                  color: "var(--danger, #ef4444)",
                  fontSize: 13,
                  textAlign: "left",
                }}
              >
                {error}
              </div>
            )}

            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 12,
              }}
            >
              <button
                type="button"
                className="btn btn-primary"
                onClick={saveUsername}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save"}
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={cancelEditing}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Read receipts */}
        <div className="profile-setting">
          <div className="profile-setting-info">
            <div className="profile-setting-title">
              Read receipts
            </div>

            <div className="profile-setting-description">
              Let people know when you have read their messages.
            </div>
          </div>

          <div className="profile-setting-control">
            <span
              className={
                "profile-setting-status " +
                (readReceiptsEnabled ? "enabled" : "disabled")
              }
            >
              {readReceiptsEnabled ? "ON" : "OFF"}
            </span>

            <button
              type="button"
              className={
                "setting-toggle" +
                (readReceiptsEnabled ? " active" : "")
              }
              onClick={toggleReadReceipts}
              disabled={savingReadReceipts}
              aria-pressed={readReceiptsEnabled}
              aria-label={
                readReceiptsEnabled
                  ? "Turn off read receipts"
                  : "Turn on read receipts"
              }
            >
              <span className="setting-toggle-thumb" />
            </button>
          </div>
        </div>

        {/* Last seen and online */}
        <div className="profile-setting">
          <div className="profile-setting-info">
            <div className="profile-setting-title">
              Show last seen & online
            </div>

            <div className="profile-setting-description">
              Let contacts see when you&apos;re online and when you were last seen.
            </div>
          </div>

          <div className="profile-setting-control">
            <span
              className={
                "profile-setting-status " +
                (showLastSeenEnabled ? "enabled" : "disabled")
              }
            >
              {showLastSeenEnabled ? "ON" : "OFF"}
            </span>

            <button
              type="button"
              className={
                "setting-toggle" +
                (showLastSeenEnabled ? " active" : "")
              }
              onClick={toggleShowLastSeen}
              disabled={savingShowLastSeen}
              aria-pressed={showLastSeenEnabled}
              aria-label={
                showLastSeenEnabled
                  ? "Turn off last seen and online"
                  : "Turn on last seen and online"
              }
            >
              <span className="setting-toggle-thumb" />
            </button>
          </div>
        </div>

        {/* Appearance / Theme */}
        <div className="profile-setting">
          <div className="profile-setting-info">
            <div className="profile-setting-title">
              Appearance
            </div>

            <div className="profile-setting-description">
              Switch between light and dark themes.
            </div>
          </div>

          <div className="profile-setting-control">
            <ThemeToggle />
          </div>
        </div>

        {/* Notifications */}
        <div className="profile-setting">
          <div className="profile-setting-info">
            <div className="profile-setting-title">
              Notifications
            </div>

            <div className="profile-setting-description">
              Get notified when someone sends you a new message.
            </div>
          </div>

          <div className="profile-setting-control">
            <span
              className={
                "profile-setting-status " +
                (notificationsEnabled ? "enabled" : "disabled")
              }
            >
              {notificationsEnabled ? "ON" : "OFF"}
            </span>

            <button
              type="button"
              className={
                "setting-toggle" +
                (notificationsEnabled ? " active" : "")
              }
              onClick={toggleNotifications}
              disabled={savingNotifications}
              aria-pressed={notificationsEnabled}
              aria-label={
                notificationsEnabled
                  ? "Turn off notifications"
                  : "Turn on notifications"
              }
            >
              <span className="setting-toggle-thumb" />
            </button>
          </div>
        </div>

        {/* Log out */}
        <div
          className="profile-setting"
          style={{
            marginTop: 16,
            borderTop:
              "1px solid var(--border-color, rgba(255,255,255,0.08))",
            paddingTop: 16,
          }}
        >
          <div className="profile-setting-info">
            <div className="profile-setting-title">
              Log out
            </div>

            <div className="profile-setting-description">
              Sign out of your account on this device.
            </div>
          </div>

          <div className="profile-setting-control">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleLogout}
              disabled={loggingOut}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <LogOut size={16} strokeWidth={2} />
              {loggingOut ? "Logging out…" : "Log out"}
            </button>
          </div>
        </div>

        {/* Delete account */}
        <div
          className="profile-setting"
          style={{
            marginTop: 16,
            borderTop:
              "1px solid var(--border-color, rgba(255,255,255,0.08))",
            paddingTop: 16,
          }}
        >
          <div className="profile-setting-info">
            <div
              className="profile-setting-title"
              style={{
                color: "var(--danger, #ef4444)",
              }}
            >
              Delete account
            </div>

            <div className="profile-setting-description">
              Permanently delete your account, conversations,
              messages, and uploaded media.
            </div>
          </div>

          <div className="profile-setting-control">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowDeleteAccountModal(true)}
              disabled={deletingAccount}
              style={{
                color: "var(--danger, #ef4444)",
                borderColor: "var(--danger, #ef4444)",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Trash2 size={15} strokeWidth={2} />
              {deletingAccount
                ? "Deleting…"
                : "Delete account"}
            </button>
          </div>
        </div>

        {/* Delete account confirmation modal */}
        {showDeleteAccountModal && (
          <div
            role="presentation"
            onMouseDown={(event) => {
              if (
                event.target === event.currentTarget &&
                !deletingAccount
              ) {
                setShowDeleteAccountModal(false);
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
              background: "rgba(0, 0, 0, 0.58)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-account-title"
              aria-describedby="delete-account-description"
              onMouseDown={(event) => {
                event.stopPropagation();
              }}
              style={{
                width: "100%",
                maxWidth: "420px",
                boxSizing: "border-box",
                borderRadius: "20px",
                padding: "24px",
                background:
                  "var(--card-background, var(--background, #111))",
                border:
                  "1px solid var(--border-color, rgba(255,255,255,0.1))",
                boxShadow: "0 24px 80px rgba(0, 0, 0, 0.35)",
              }}
            >
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "14px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: "16px",
                  background: "rgba(239, 68, 68, 0.12)",
                  color: "var(--danger, #ef4444)",
                }}
              >
                <AlertTriangle size={24} strokeWidth={2} />
              </div>

              <h2
                id="delete-account-title"
                style={{
                  margin: 0,
                  fontSize: "21px",
                  lineHeight: 1.3,
                  fontWeight: 700,
                }}
              >
                Delete account?
              </h2>

              <p
                id="delete-account-description"
                style={{
                  margin: "12px 0 24px",
                  fontSize: "14px",
                  lineHeight: 1.6,
                  opacity: 0.72,
                }}
              >
                Your profile, conversations, messages, avatar,
                and uploaded media will be permanently deleted.
                This action cannot be undone.
              </p>

              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  justifyContent: "flex-end",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowDeleteAccountModal(false)}
                  disabled={deletingAccount}
                  style={{
                    minWidth: "100px",
                  }}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={deleteAccount}
                  disabled={deletingAccount}
                  style={{
                    minWidth: "120px",
                    color: "#ffffff",
                    background: "var(--danger, #ef4444)",
                    borderColor: "var(--danger, #ef4444)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                  }}
                >
                  <Trash2 size={16} strokeWidth={2} />
                  {deletingAccount ? "Deleting…" : "Delete account"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Error outside username editor */}
        {!editingUsername && error && (
          <div
            role="alert"
            style={{
              marginTop: 12,
              color: "var(--danger, #ef4444)",
              fontSize: 13,
              textAlign: "center",
            }}
          >
            {error}
          </div>
        )}
      </section>
    </main>
  );
}
