/** Contracts of the Phase 3 API: customers, conversations and messages. */

export type ChannelType = 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK';
export type CustomerStatus = 'ACTIVE' | 'BLOCKED' | 'ARCHIVED';
export type ConversationStatus = 'OPEN' | 'PENDING' | 'RESOLVED' | 'CLOSED';
export type ConversationMode = 'AI' | 'HUMAN';
export type SenderType = 'CUSTOMER' | 'AI' | 'AGENT' | 'SYSTEM';
export type MessageDirection = 'INBOUND' | 'OUTBOUND';
export type MessageType = 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'FILE' | 'LOCATION' | 'SYSTEM';
export type DeliveryStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface CustomerIdentity {
  id: string;
  channel: ChannelType;
  platformUserId: string;
  displayName: string | null;
  profileUrl?: string | null;
  createdAt?: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  altPhone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  tags: string[];
  status: CustomerStatus;
  totalOrders: number;
  totalSpent: number;
  outstandingDebt: number;
  lastOrderAt: string | null;
  lastContactAt: string | null;
  createdAt: string;
  updatedAt: string;
  identities: CustomerIdentity[];
  channels: ChannelType[];
  conversationsCount: number;
}

export interface CustomerConversationSummary {
  id: string;
  channel: ChannelType;
  status: ConversationStatus;
  mode: ConversationMode;
  unreadCount: number;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface CustomerDetail extends Customer {
  recentConversations: CustomerConversationSummary[];
}

export interface MessagePreview {
  id: string;
  content: string;
  type: MessageType;
  senderType: SenderType;
  senderUserId: string | null;
  direction: MessageDirection;
  deliveryStatus: DeliveryStatus;
  createdAt: string;
}

export interface Conversation {
  id: string;
  channel: ChannelType;
  channelId: string | null;
  status: ConversationStatus;
  mode: ConversationMode;
  subject: string | null;
  unreadCount: number;
  handoverReason: string | null;
  handoverAt: string | null;
  lastMessageAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  customer: { id: string; name: string; phone: string | null; city: string | null; status: CustomerStatus };
  assignedUser: { id: string; fullName: string } | null;
  lastMessage: MessagePreview | null;
}

export interface ConversationDetail extends Omit<Conversation, 'customer'> {
  customer: {
    id: string;
    name: string;
    phone: string | null;
    altPhone: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    notes: string | null;
    tags: string[];
    status: CustomerStatus;
    totalOrders: number;
    totalSpent: number;
    lastOrderAt: string | null;
    identities: CustomerIdentity[];
  };
}

export interface ConversationStats {
  byStatus: Record<ConversationStatus, number>;
  active: number;
  unread: number;
  human: number;
  mine: number;
  unassigned: number;
}

export interface Message {
  id: string;
  conversationId: string;
  senderType: SenderType;
  direction: MessageDirection;
  type: MessageType;
  content: string;
  mediaUrl: string | null;
  metadata: Record<string, unknown> | null;
  deliveryStatus: DeliveryStatus;
  failureReason: string | null;
  createdAt: string;
  senderUser: { id: string; fullName: string } | null;
}

export interface MessagePage {
  items: Message[];
  hasMore: boolean;
  nextBefore: string | null;
}
