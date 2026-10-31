"use client";

import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import VerifiedBadge from "@/components/VerifiedBadge";

export default function Header({
  username,
  avatarUrl,
  isVerified,
  onNewChat,
  onLogout,
}: {
  username: string;
  isVerified: boolean;
  avatarUrl?: string | null;
  onNewChat: () => void;
  onLogout?: () => void;
}) {
  const router = useRouter();

  return (
    <header className="app-header">
      <div className="brand">Messaging</div>

      <div className="header-right">
        <button
          type="button"
          className="profile-button"
          onClick={() => router.push("/profile")}
          aria-label="Open profile"
          title="Profile"
        >
          <span className="profile-button-avatar" aria-hidden="true">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                className="avatar-image"
              />
            ) : (
              username.charAt(0).toUpperCase()
            )}
          </span>

          <span className="profile-button-name">
            {username}
            {isVerified && <VerifiedBadge size={15} />}
          </span>
        </button>

        <button
          type="button"
          className="icon-btn"
          aria-label="New conversation"
          title="New conversation"
          onClick={onNewChat}
        >
          <Plus size={20} strokeWidth={2} />
        </button>
      </div>
    </header>
  );
}
