/** Models a merchant can pick for their agent. */
export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', description: 'الأدق في فهم الطلبات المعقدة' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', description: 'توازن بين السرعة والدقة' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', description: 'الأسرع والأقل تكلفة' },
] as const;

export type AiModelId = (typeof AI_MODELS)[number]['id'];

export const AI_MODEL_IDS = AI_MODELS.map((model) => model.id) as AiModelId[];

/**
 * Models with server-side refusal fallback. Haiku has none: a declined request there
 * stays declined, and the agent hands the conversation to a person instead.
 */
export const MODELS_WITH_FALLBACK = new Set<string>(['claude-opus-5-5', 'claude-sonnet-5-5']);

/** Tool calls one reply may make before the agent gives up and hands over. */
export const MAX_TOOL_ROUNDS = 6;

/** Earlier messages the agent reads to understand the conversation. */
export const HISTORY_LIMIT = 30;

/** A reply longer than this is cut; WhatsApp refuses longer texts. */
export const MAX_REPLY_LENGTH = 4096;

/** How long one reply may hold the conversation before another may take over. */
export const REPLY_LEASE_MS = 3 * 60_000;

export const TONES = {
  friendly: 'ودود وبسيط، كأنك تتكلم مع زبون تعرفه',
  formal: 'رسمي ومهذّب',
  enthusiastic: 'متحمس ومشجّع، مع حماس واضح للمنتجات',
} as const;

export type AiTone = keyof typeof TONES;

export const LANGUAGES = {
  'ar-IQ': 'Iraqi Arabic dialect',
  ar: 'Modern Standard Arabic',
  en: 'English',
} as const;

export type AiLanguage = keyof typeof LANGUAGES;

/** Reasons recorded on a conversation when the agent hands it to a person. */
export const HANDOVER = {
  KEYWORD: (keyword: string) => `طلب الزبون التحدث مع موظف («${keyword}»)`,
  REFUSAL: 'رفض المساعد الذكي الرد على هذه الرسالة',
  FAILURE: 'تعذّر على المساعد الذكي الرد',
  TOO_MANY_STEPS: 'المحادثة احتاجت خطوات أكثر مما يستطيع المساعد الذكي',
} as const;

/** What the customer is told while a person takes over. */
export const HANDOVER_REPLY = 'تم تحويلك إلى أحد موظفينا، وسيرد عليك بأقرب وقت.';
