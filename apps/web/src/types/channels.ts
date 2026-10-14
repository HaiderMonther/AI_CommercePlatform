import type { ChannelType } from './crm';

export type ChannelStatus = 'DISCONNECTED' | 'CONNECTED' | 'ERROR';

/** A WhatsApp number, Facebook page or Instagram account connected to the store. */
export interface ChannelConnection {
  id: string;
  type: ChannelType;
  name: string;
  /** phone_number_id, page id or IG account id */
  externalId: string;
  status: ChannelStatus;
  lastError: string | null;
  lastSyncAt: string | null;
  isActive: boolean;
  hasAccessToken: boolean;
  /** Last characters of the installed token; the token itself never leaves the API. */
  tokenHint: string | null;
  conversationsCount: number;
  /** Relative to the API prefix, e.g. `webhooks/whatsapp`. */
  webhookPath: string;
  createdAt: string;
  updatedAt: string;
}
