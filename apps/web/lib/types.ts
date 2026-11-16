export interface Inbox {
  id: string;
  address: string;
  createdAt: string;
  expiresAt: string;
  messageCount: number;
  unreadCount: number;
}

export interface MessageSummary {
  id: string;
  inboxId: string;
  inboxAddress: string;
  fromAddress: string;
  fromName: string | null;
  subject: string | null;
  preview: string;
  otpCode: string | null;
  isRead: boolean;
  attachmentCount: number;
  receivedAt: string;
}

export interface MessagePage {
  messages: MessageSummary[];
  nextCursor: string | null;
}

export interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  isBlocked: boolean;
}

export interface MessageDetail {
  id: string;
  inboxId: string;
  inboxAddress: string;
  fromAddress: string;
  fromName: string | null;
  subject: string | null;
  textBody: string | null;
  htmlSanitized: string | null;
  otpCode: string | null;
  isRead: boolean;
  sizeBytes: number;
  receivedAt: string;
  attachments: Attachment[];
}

/** "unified" or the id of one inbox. */
export type InboxView = "unified" | (string & {});
