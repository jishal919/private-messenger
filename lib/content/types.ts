export type MessageReceiptStatus =
  | "sent"
  | "delivered"
  | "read";

export interface MessageReceiptState {
  deliveredMessageId: string | null;
  readMessageId: string | null;
}

export type ContentProvider =
  | "turso"
  | "postgres"
  | "supabase"
  | "custom";

export type ContentMessageType =
  | "text"
  | "voice"
  | "image"
  | "video"
  | "document"
  | "file";

export interface ContentConversation {
  id: string;
  user1Id: string;
  user2Id: string;
  createdAt: number;
  lastMessageAt: number | null;
}

export interface ContentMessage {
  id: string;
  conversationId: string;
  senderId: string;
  type: ContentMessageType;
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
  replyToMessageId: string | null;
  clientId: string | null;
  isForwarded?: boolean | null;
  deletedForEveryone?: boolean | null;
  createdAt: number;
}

export interface ReadState {
  conversationId: string;
  userId: string;
  lastDeliveredMessageId: string | null;
  lastReadMessageId: string | null;
}

export interface TypingState {
  userId: string;
  expiresAt: number;
  state: "typing" | "recording";
}

export interface CreateMessageInput {
  conversationId: string;
  senderId: string;
  type: ContentMessageType;
  content?: string | null;
  mediaKey?: string | null;
  mediaSize?: number | null;
  durationMs?: number | null;
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
  clientId?: string | null;
  isForwarded?: boolean | null;
}

export interface ContentShard {
  id: string;
  provider: ContentProvider;

  conversations: {
    create(conversation: ContentConversation): Promise<void>;
    get(id: string): Promise<ContentConversation | null>;
    deleteForUser(userId: string): Promise<void>;
  };

  messages: {
    create(input: CreateMessageInput): Promise<ContentMessage>;
    get(id: string): Promise<ContentMessage | null>;
    getMany(
      conversationId: string,
      ids: string[]
    ): Promise<ContentMessage[]>;
    getByMediaKey(
      conversationId: string,
      mediaKey: string
    ): Promise<ContentMessage | null>;
    latest(conversationId: string, limit: number): Promise<ContentMessage[]>;
    before(
      conversationId: string,
      beforeId: string,
      limit: number
    ): Promise<ContentMessage[]>;
    after(
      conversationId: string,
      afterId: string,
      limit: number
    ): Promise<ContentMessage[]>;
    getExpired(now: number, limit: number): Promise<ContentMessage[]>;
    markMediaExpired(messageId: string): Promise<void>;
    getMediaForUser(userId: string): Promise<ContentMessage[]>;
    deleteForEveryone(messageId: string): Promise<void>;
    deletePermanently(messageId: string, conversationId?: string): Promise<void>;
    invalidateMediaKey(mediaKey: string): Promise<void>;
    hideForUser(
      messageId: string,
      userId: string,
      deletedAt: number
    ): Promise<void>;
    unhideForUser(
      messageId: string,
      userId: string
    ): Promise<void>;
    isHiddenForUser(
      messageId: string,
      userId: string
    ): Promise<boolean>;
    getHiddenMessageIds(
      conversationId: string,
      userId: string
    ): Promise<string[]>;
    getDeletedForEveryoneIds(
      conversationId: string
    ): Promise<string[]>;
  };

  reads: {
    get(
      conversationId: string,
      userId: string
    ): Promise<ReadState | null>;

    markDelivered(
      conversationId: string,
      userId: string,
      messageId: string
    ): Promise<void>;

    markRead(
      conversationId: string,
      userId: string,
      messageId: string
    ): Promise<void>;
  };

  getMessageReceiptStatus(
    conversationId: string,
    messageId: string,
    recipientUserId: string
  ): Promise<MessageReceiptStatus>;

  typing: {
    set(
      conversationId: string,
      userId: string,
      expiresAt: number,
      state?: "typing" | "recording"
    ): Promise<void>;

    clear(
      conversationId: string,
      userId: string
    ): Promise<void>;

    get(
      conversationId: string
    ): Promise<TypingState[]>;
  };
}
