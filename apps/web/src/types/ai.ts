import type { PaymentMethod } from './orders';

export interface AiModelOption {
  id: string;
  label: string;
  description: string;
}

/** The company's AI agent settings, as the API returns them. */
export interface AiSettings {
  id: string;
  enabled: boolean;
  autoReply: boolean;
  businessName: string | null;
  businessDescription: string | null;
  tone: string;
  language: string;
  currency: string;
  workingHours: string | null;
  returnPolicy: string | null;
  deliveryPolicy: string | null;
  paymentMethods: PaymentMethod[];
  customInstructions: string | null;
  model: string;
  handoverKeywords: string[];
  updatedAt: string;
  /** False when the server has no Claude API key: nothing is answered automatically. */
  providerConfigured: boolean;
  options: { models: AiModelOption[]; tones: string[]; languages: string[] };
}

export type AiSettingsPayload = Partial<
  Omit<AiSettings, 'id' | 'currency' | 'updatedAt' | 'providerConfigured' | 'options'>
>;

export interface AiTestTurn {
  role: 'customer' | 'assistant';
  content: string;
}

export interface AiTestResult {
  reply: string | null;
  handoverReason: string | null;
  toolCalls: { name: string; input: unknown; isError: boolean }[];
  model: string;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  latencyMs: number;
}
