export type ApiUser = {
  id: string;
  username: string;
  isVerified: boolean;
  avatarUrl?: string | null;
};

export type ApiMessageType =
  | "text"
  | "voice"
  | "image"
  | "video"
  | "document"
  | "file";

export type ApiReplyPreview = {
  id: string;
  senderId: string;
  senderUsername: string;
  type: ApiMessageType;
  preview: string;
  available?: boolean;
};

export type ApiMessage = {
  id: string;
  senderId: string;
  type: ApiMessageType;
  content: string | null;
  mediaKey: string | null;
  mediaSize: number | null;
  durationMs: number | null;
  mediaProvider?: string | null;
  mediaCategory?: "image" | "video" | "document" | null;
  mediaMimeType?: string | null;
  mediaOriginalSize?: number | null;
  mediaName?: string | null;
  mediaExpiresAt?: number | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
  mediaObjectId?: string | null;
  replyToMessageId?: string | null;
  replyTo?: ApiReplyPreview | null;
  createdAt: number;
  receiptStatus: "sent" | "delivered" | "read";
  clientId?: string | null;
  isForwarded?: boolean;
  deletedForEveryone?: boolean;
};

export function generateClientId(): string {
  if (
    typeof crypto !== "undefined" &&
    "randomUUID" in crypto
  ) {
    return crypto.randomUUID();
  }

  return `c${Date.now()}${Math.random()
    .toString(16)
    .slice(2)}`;
}

export type ApiConversation = {
  id: string;
  otherUser: ApiUser;
  lastMessage: string | null;
  lastMessageAt: number | null;
  lastMessageFromMe: boolean;
  unread: boolean;
};

export type ApiConversationStatus = {
  presence: {
    visible: boolean;
    online: boolean;
    lastSeenAt: number | null;
  };
  composerState: "typing" | "recording" | null;
};

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    credentials: "same-origin",
  });

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // no body
  }

  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: unknown }).error ?? "Something went wrong.")
        : "Something went wrong.";
    throw new ApiError(message, res.status);
  }

  return data as T;
}

export { ApiError };

export function apiRegister(username: string, password: string) {
  return request<{ user: ApiUser }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function apiLogin(username: string, password: string) {
  return request<{ user: ApiUser }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}


export function apiLogout() {
  return request<{ ok: true }>("/api/auth/logout", { method: "POST" });
}


export function apiUpdateUsername(username: string) {
  return request<{ user: ApiUser }>("/api/profile/username", {
    method: "PATCH",
    body: JSON.stringify({ username }),
  });
}

export function apiSearchUsers(query: string, signal?: AbortSignal) {
  return request<{ users: ApiUser[] }>(
    `/api/users/search?q=${encodeURIComponent(query)}`,
    { signal }
  );
}

export function apiListConversations() {
  return request<{ conversations: ApiConversation[] }>(
    "/api/conversations"
  );
}

export function apiOpenConversation(username: string) {
  return request<{
    conversation: {
      id: string;
      otherUser: ApiUser;
    };
  }>("/api/conversations", {
    method: "POST",
    body: JSON.stringify({ username }),
  });
}

export function apiLoadLatestMessages(conversationId: string) {
  return request<{
    messages: ApiMessage[];
    hasMore: boolean;
    deletedMessageIds?: string[];
  }>(`/api/conversations/${conversationId}/messages`);
}

export function apiLoadOlderMessages(
  conversationId: string,
  beforeId: string
) {
  return request<{
    messages: ApiMessage[];
    hasMore: boolean;
    deletedMessageIds?: string[];
  }>(
    `/api/conversations/${conversationId}/messages?before=${encodeURIComponent(
      beforeId
    )}`
  );
}

export function apiLoadNewMessages(
  conversationId: string,
  afterId: string | null
) {
  const query = afterId
    ? `?after=${encodeURIComponent(afterId)}`
    : "";

  return request<{
    messages: ApiMessage[];
    hasMore?: boolean;
    deletedMessageIds?: string[];
  }>(`/api/conversations/${conversationId}/messages${query}`);
}

export function apiLoadMessagesAround(
  conversationId: string,
  messageId: string
) {
  return request<{
    messages: ApiMessage[];
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
    latestMessageId: string | null;
  }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages?around=${encodeURIComponent(messageId)}`
  );
}

export function apiSendMessage(
  conversationId: string,
  content: string,
  clientId: string,
  replyToMessageId?: string | null,
  isForwarded?: boolean
) {
  return request<{ message: ApiMessage }>(
    `/api/conversations/${conversationId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ content, clientId, replyToMessageId, isForwarded }),
    }
  );
}

export async function apiSendVoiceMessage(
  conversationId: string,
  audioBlob: Blob,
  durationMs: number,
  clientId: string,
  replyToMessageId?: string | null
): Promise<{ message: ApiMessage }> {
  const formData = new FormData();
  formData.append("file", audioBlob, "recording.webm");
  formData.append("durationMs", String(Math.round(durationMs)));
  formData.append("clientId", clientId);
  if (replyToMessageId) {
    formData.append("replyToMessageId", replyToMessageId);
  }

  const res = await fetch(`/api/conversations/${conversationId}/voice`, {
    method: "POST",
    body: formData,
    credentials: "same-origin",
  });

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // no body
  }

  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: unknown }).error ?? "Something went wrong.")
        : "Something went wrong.";
    throw new ApiError(message, res.status);
  }

  return data as { message: ApiMessage };
}

export function getMediaUrl(
  conversationId: string,
  mediaKey: string
): string {
  const cleanKey = mediaKey.replace(/^\/+/, "");
  return `/api/conversations/${encodeURIComponent(
    conversationId
  )}/media/${cleanKey}`;
}



export function apiMarkConversationRead(
  conversationId: string,
  messageId: string
) {
  return request<{ success: boolean }>(
    `/api/conversations/${conversationId}/read`,
    {
      method: "POST",
      body: JSON.stringify({
        messageId,
      }),
    }
  );
}



export type ApiReceiptCursor = {
  id: string;
  createdAt: number;
};

export function apiLoadReceipts(
  conversationId: string
) {
  return request<{
    delivered: ApiReceiptCursor | null;
    read: ApiReceiptCursor | null;
  }>(
    `/api/conversations/${conversationId}/receipts`
  );
}

export function apiHeartbeatPresence(presenceId: string, conversationId?: string | null) {
  return request<{ ok: true }>("/api/presence/heartbeat", {
    method: "POST",
    body: JSON.stringify({ presenceId, conversationId: conversationId ?? null }),
  });
}

export function apiLoadConversationStatus(
  conversationId: string,
  signal?: AbortSignal
) {
  return request<ApiConversationStatus>(
    `/api/conversations/${conversationId}/status`,
    { signal }
  );
}

export function apiUpdateComposerState(
  conversationId: string,
  state: "typing" | "recording" | "idle"
) {
  return request<{ ok: true }>(
    `/api/conversations/${conversationId}/typing`,
    {
      method: "POST",
      body: JSON.stringify({ state }),
    }
  );
}


export function apiAcknowledgeDelivery() {
  return request<{
    success: boolean;
    deliveredCount: number;
  }>("/api/conversations/deliver", {
    method: "POST",
  });
}




export function apiGetProfileSettings() {
  return request<{
    settings: {
    readReceiptsEnabled: boolean;
    notificationsEnabled: boolean;
    showLastSeenEnabled: boolean;
  }
  }>("/api/profile/settings");
}

export function apiUpdateReadReceipts(enabled: boolean) {
  return request<{
    settings: {
      readReceiptsEnabled: boolean;
    };
  }>("/api/profile/settings", {
    method: "PATCH",
    body: JSON.stringify({
      readReceiptsEnabled: enabled,
    }),
  });
}


export function apiGetNotificationSettings() {
  return request<{
    settings: {
      notificationsEnabled: boolean;
    };
  }>("/api/profile/settings");
}

export function apiUpdateNotifications(enabled: boolean) {
  return request<{
    settings: {
      notificationsEnabled: boolean;
    };
  }>("/api/profile/settings", {
    method: "PATCH",
    body: JSON.stringify({
      notificationsEnabled: enabled,
    }),
  });
}

export function apiUpdateShowLastSeen(enabled: boolean) {
  return request<{
    settings: {
      showLastSeenEnabled: boolean;
    };
  }>("/api/profile/settings", {
    method: "PATCH",
    body: JSON.stringify({
      showLastSeenEnabled: enabled,
    }),
  });
}

export type PushSubscriptionJSON = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export function apiSavePushSubscription(
  subscription: PushSubscriptionJSON
) {
  return request<{ ok: true }>(
    "/api/profile/notifications/subscribe",
    {
      method: "POST",
      body: JSON.stringify(subscription),
    }
  );
}

export function apiDeletePushSubscription(
  endpoint: string
) {
  return request<{ ok: true }>(
    "/api/profile/notifications/subscribe",
    {
      method: "DELETE",
      body: JSON.stringify({ endpoint }),
    }
  );
}


export function apiUpdateAvatar(
  avatarKey: string,
  avatarFileId: string
) {
  return request<{
    avatarKey: string;
    avatarFileId: string;
  }>("/api/profile/avatar", {
    method: "PATCH",
    body: JSON.stringify({
      avatarKey,
      avatarFileId,
    }),
  });
}


export function apiRemoveAvatar() {
  return request<{
    avatarKey: null;
  }>("/api/profile/avatar", {
    method: "DELETE",
  });
}


export function apiDeleteAccount() {
  return request<{ success: boolean }>(
    "/api/profile/delete",
    {
      method: "DELETE",
    }
  );
}


export interface ApiUploadAuthorization {
  uploadUrl: string;
  key: string;
  method: "PUT";
  headers?: Record<string, string>;
  expiresIn: number;
  category: "image" | "video" | "document";
}

export function apiGetMediaUploadAuthorization(
  conversationId: string,
  params: {
    category: "image" | "video" | "document";
    filename: string;
    mimeType: string;
    fileSize: number;
  }
) {
  return request<{ authorization: ApiUploadAuthorization }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/media/upload-url`,
    {
      method: "POST",
      body: JSON.stringify(params),
    }
  );
}

export function apiSendMediaMessage(
  conversationId: string,
  params: {
    type: "image" | "video" | "document" | "voice";
    mediaKey: string;
    mediaSize?: number | null;
    mediaOriginalSize?: number | null;
    mediaMimeType?: string | null;
    mediaName?: string | null;
    mediaWidth?: number | null;
    mediaHeight?: number | null;
    durationMs?: number | null;
    content?: string | null;
    clientId: string;
    replyToMessageId?: string | null;
    isForwarded?: boolean;
  }
) {
  return request<{ message: ApiMessage }>(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify(params),
    }
  );
}

export function apiForwardMessage(
  sourceConversationId: string,
  messageId: string,
  targetConversationIds: string[]
) {
  return request<{ forwarded: number }>(
    `/api/conversations/${encodeURIComponent(sourceConversationId)}/messages/${encodeURIComponent(messageId)}/forward`,
    {
      method: "POST",
      body: JSON.stringify({ targetConversationIds }),
    }
  );
}

export function apiDeleteMessage(
  conversationId: string,
  messageId: string,
  deleteFor: "everyone" | "me"
) {
  return request<{ ok: true; deletedFor: "everyone" | "me" }>(
    `/api/conversations/${conversationId}/messages/${messageId}`,
    {
      method: "DELETE",
      body: JSON.stringify({ deleteFor }),
    }
  );
}

export function apiUndoDeleteMessage(
  conversationId: string,
  messageId: string
) {
  return request<{ ok: true; undone: true }>(
    `/api/conversations/${conversationId}/messages/${messageId}`,
    {
      method: "DELETE",
      body: JSON.stringify({ action: "undo" }),
    }
  );
}
