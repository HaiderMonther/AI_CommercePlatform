import { ChannelType, SenderType } from '@prisma/client';
import {
  AgentProfile,
  buildContextBlock,
  buildHistory,
  buildSystemPrompt,
  matchHandoverKeyword,
} from './ai-prompt';

const profile: AgentProfile = {
  businessName: 'متجر بغداد',
  businessDescription: 'ملابس رجالية',
  tone: 'friendly',
  language: 'ar-IQ',
  currency: 'IQD',
  workingHours: { text: 'يومياً 10 صباحاً - 10 مساءً' },
  returnPolicy: 'الإرجاع خلال 3 أيام',
  deliveryPolicy: null,
  paymentMethods: ['CASH_ON_DELIVERY', 'ZAIN_CASH'],
  customInstructions: 'لا تذكر المنافسين',
  company: { phone: null, city: 'بغداد', address: null },
};

describe('buildSystemPrompt', () => {
  const prompt = buildSystemPrompt(profile);

  it('carries the store facts the merchant configured', () => {
    expect(prompt).toContain('متجر بغداد');
    expect(prompt).toContain('الإرجاع خلال 3 أيام');
    expect(prompt).toContain('يومياً 10 صباحاً - 10 مساءً');
    expect(prompt).toContain('ZAIN_CASH = زين كاش');
    expect(prompt).toContain('لا تذكر المنافسين');
  });

  it('leaves out what was not configured', () => {
    expect(prompt).not.toContain('Delivery policy');
  });

  it('is identical for every conversation, so it stays cacheable', () => {
    expect(buildSystemPrompt(profile)).toBe(prompt);
  });

  it('falls back to cash on delivery when no payment method is set', () => {
    expect(buildSystemPrompt({ ...profile, paymentMethods: [] })).toContain('CASH_ON_DELIVERY');
  });
});

describe('buildContextBlock', () => {
  it('describes the customer and their recent orders', () => {
    const block = buildContextBlock(
      {
        name: 'علي',
        phone: '+9647701234567',
        city: null,
        address: null,
        channel: ChannelType.INSTAGRAM,
        recentOrders: [
          { orderNumber: 1004, status: 'SHIPPED', total: 30000, createdAt: new Date('2026-10-01') },
        ],
      },
      new Date('2026-10-14T09:00:00Z'),
    );

    expect(block).toContain('Instagram');
    expect(block).toContain('+9647701234567');
    expect(block).toContain('City: unknown');
    expect(block).toContain('#1004 (SHIPPED');
  });
});

describe('buildHistory', () => {
  const message = (senderType: SenderType, content: string) => ({ senderType, content });

  it('maps customer turns to user and replies to assistant, merging consecutive ones', () => {
    expect(
      buildHistory([
        message(SenderType.CUSTOMER, 'هلا'),
        message(SenderType.CUSTOMER, 'عندكم قمصان؟'),
        message(SenderType.AI, 'نعم'),
        message(SenderType.CUSTOMER, 'بكم؟'),
      ]),
    ).toEqual([
      { role: 'user', content: 'هلا\nعندكم قمصان؟' },
      { role: 'assistant', content: 'نعم' },
      { role: 'user', content: 'بكم؟' },
    ]);
  });

  it('marks staff replies so the agent knows a person answered', () => {
    const turns = buildHistory([
      message(SenderType.CUSTOMER, 'متى يوصل؟'),
      message(SenderType.AGENT, 'باچر'),
      message(SenderType.CUSTOMER, 'شكراً'),
    ]);

    expect(turns?.[1].content).toBe('[رد موظف المتجر] باچر');
  });

  it('drops opening replies and system messages', () => {
    expect(
      buildHistory([
        message(SenderType.AGENT, 'أهلاً بك'),
        message(SenderType.SYSTEM, 'تم التحويل'),
        message(SenderType.CUSTOMER, 'هلا'),
      ]),
    ).toEqual([{ role: 'user', content: 'هلا' }]);
  });

  it('returns null when the customer has nothing waiting for an answer', () => {
    expect(
      buildHistory([message(SenderType.CUSTOMER, 'هلا'), message(SenderType.AI, 'أهلاً')]),
    ).toBeNull();
    expect(buildHistory([])).toBeNull();
  });
});

describe('matchHandoverKeyword', () => {
  it('finds a keyword inside the message', () => {
    expect(matchHandoverKeyword('اريد اكلم موظف رجاءً', ['موظف', 'شكوى'])).toBe('موظف');
  });

  it('ignores hamza and taa marbuta differences', () => {
    expect(matchHandoverKeyword('عندي شكوة', ['شكوى'])).toBeNull();
    expect(matchHandoverKeyword('أريد الإدارة', ['اداره'])).toBe('اداره');
  });

  it('returns null without a match or with blank keywords', () => {
    expect(matchHandoverKeyword('شكد سعر القميص', ['موظف', '  '])).toBeNull();
  });
});
