import Anthropic from '@anthropic-ai/sdk';
import { ChannelType } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { AiAgentService, AgentRunInput } from './ai-agent.service';
import { AiClient, AiRequest, AiResponse } from './ai-client';
import { AiToolExecutor } from './ai-tools';
import { HANDOVER, MAX_TOOL_ROUNDS } from './ai.constants';

type Block = AiResponse['content'][number];

function response(
  content: Partial<Block>[],
  stopReason: AiResponse['stop_reason'],
  extra: Partial<AiResponse> = {},
): AiResponse {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: content as Block[],
    stop_reason: stopReason,
    stop_details: null,
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 50,
      cache_creation_input_tokens: 0,
    },
    ...extra,
  } as unknown as AiResponse;
}

const text = (value: string) => ({ type: 'text' as const, text: value });
const toolUse = (id: string, name: string, input: unknown) => ({
  type: 'tool_use' as const,
  id,
  name,
  input,
});

const input = (model = 'claude-opus-5-5'): AgentRunInput => ({
  companyId: 'company-1',
  model,
  profile: {
    businessName: 'متجر',
    businessDescription: null,
    tone: 'friendly',
    language: 'ar-IQ',
    currency: 'IQD',
    workingHours: null,
    returnPolicy: null,
    deliveryPolicy: null,
    paymentMethods: [],
    customInstructions: null,
    company: { phone: null, city: null, address: null },
  },
  customer: {
    name: 'علي',
    phone: null,
    city: null,
    address: null,
    channel: ChannelType.WHATSAPP,
    recentOrders: [],
  },
  history: [{ role: 'user', content: 'بكم القميص؟' }],
  tools: { customerId: 'customer-1', conversationId: 'conversation-1', dryRun: false },
});

describe('AiAgentService', () => {
  let requests: AiRequest[];
  let replies: AiResponse[];
  let execute: jest.Mock;
  let createInteraction: jest.Mock;
  let agent: AiAgentService;

  beforeEach(() => {
    requests = [];
    replies = [];

    const client = {
      configured: true,
      createMessage: jest.fn(async (request: AiRequest) => {
        // Snapshot: the agent keeps appending to the same array.
        requests.push({ ...request, messages: [...request.messages] });
        const next = replies.shift();
        if (!next) throw new Error('no scripted reply');
        return next;
      }),
    } as unknown as AiClient;

    execute = jest.fn(async () => ({ content: '{"results":[]}', isError: false }));
    createInteraction = jest.fn(async () => ({ id: 'interaction-1' }));

    const prisma = {
      aiInteraction: { create: createInteraction },
      usageRecord: { upsert: jest.fn(async () => ({})) },
    } as unknown as PrismaService;

    agent = new AiAgentService(client, { execute } as unknown as AiToolExecutor, prisma);
  });

  it('answers directly when no tool is needed', async () => {
    replies.push(response([text('هلا بيك')], 'end_turn'));

    const result = await agent.run(input());

    expect(result.reply).toBe('هلا بيك');
    expect(result.handoverReason).toBeNull();
    expect(result.success).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  it('runs the tools Claude asks for and sends every result back in one message', async () => {
    replies.push(
      response(
        [
          toolUse('t1', 'search_products', { query: 'قميص' }),
          toolUse('t2', 'get_customer_orders', {}),
        ],
        'tool_use',
      ),
      response([text('القميص بـ 25,000 د.ع')], 'end_turn'),
    );

    const result = await agent.run(input());

    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.reply).toBe('القميص بـ 25,000 د.ع');

    const second = requests[1].messages;
    expect(second).toHaveLength(3);
    expect(second[1].role).toBe('assistant');
    expect(
      (second[2].content as Anthropic.Beta.Messages.BetaToolResultBlockParam[]).map(
        (b) => b.tool_use_id,
      ),
    ).toEqual(['t1', 't2']);
  });

  it('marks failed tool calls as errors for Claude to read', async () => {
    execute.mockResolvedValueOnce({ content: '{"error":"x"}', isError: true });
    replies.push(
      response([toolUse('t1', 'get_product_details', { product_id: 'nope' })], 'tool_use'),
      response([text('ما لگيته')], 'end_turn'),
    );

    await agent.run(input());

    const results = requests[1].messages[2]
      .content as Anthropic.Beta.Messages.BetaToolResultBlockParam[];
    expect(results[0].is_error).toBe(true);
  });

  it('reports a handover the model asked for, with its closing reply', async () => {
    execute.mockResolvedValueOnce({
      content: '{"handedOver":true}',
      isError: false,
      handoverReason: 'شكوى على التوصيل',
    });
    replies.push(
      response([toolUse('t1', 'handover_to_human', { reason: 'شكوى على التوصيل' })], 'tool_use'),
      response([text('راح يتواصل وياك موظف')], 'end_turn'),
    );

    const result = await agent.run(input());

    expect(result.handoverReason).toBe('شكوى على التوصيل');
    expect(result.reply).toBe('راح يتواصل وياك موظف');
  });

  it('hands over on a refusal without reading the content', async () => {
    replies.push(response([], 'refusal'));

    const result = await agent.run(input());

    expect(result.handoverReason).toBe(HANDOVER.REFUSAL);
    expect(result.reply).toBeNull();
  });

  it('hands over when the API fails, and records the failure', async () => {
    const result = await agent.run(input()); // no scripted reply: the client throws

    expect(result.success).toBe(false);
    expect(result.handoverReason).toBe(HANDOVER.FAILURE);
    expect(createInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ success: false }) }),
    );
  });

  it('gives up after too many tool rounds', async () => {
    for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
      replies.push(response([toolUse(`t${i}`, 'search_products', { query: 'x' })], 'tool_use'));
    }

    const result = await agent.run(input());

    expect(requests).toHaveLength(MAX_TOOL_ROUNDS);
    expect(result.handoverReason).toBe(HANDOVER.TOO_MANY_STEPS);
  });

  it('sums usage across rounds and records it', async () => {
    replies.push(
      response([toolUse('t1', 'search_products', { query: 'x' })], 'tool_use'),
      response([text('تمام')], 'end_turn'),
    );

    const result = await agent.run(input());

    expect(result.usage).toEqual({ input: 200, output: 40, cacheRead: 100, cacheWrite: 0 });
    expect(createInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          promptTokens: 300,
          completionTokens: 40,
          totalTokens: 340,
        }),
      }),
    );
  });

  describe('request shape', () => {
    beforeEach(() => replies.push(response([text('ok')], 'end_turn')));

    it('caches the stable system prompt and keeps the customer context after it', async () => {
      await agent.run(input());
      const system = requests[0].system as Anthropic.Beta.Messages.BetaTextBlockParam[];

      expect(system[0].cache_control).toEqual({ type: 'ephemeral' });
      expect(system[1].cache_control).toBeUndefined();
      expect(system[1].text).toContain('علي');
    });

    it('sends no sampling or thinking settings the current models reject', async () => {
      await agent.run(input());
      const request = requests[0] as unknown as Record<string, unknown>;

      expect(request.temperature).toBeUndefined();
      expect(request.thinking).toBeUndefined();
      expect(request.tool_choice).toBeUndefined();
      expect(request.output_config).toEqual({ effort: 'medium' });
    });

    it('opts into refusal fallback on models that have it', async () => {
      await agent.run(input('claude-opus-5-5'));

      expect(requests[0].fallbacks).toBe('default');
      expect(requests[0].betas).toEqual(['server-side-fallback-2026-07-01']);
    });

    it('does not send fallbacks to Haiku, which has none', async () => {
      await agent.run(input('claude-haiku-5-5'));

      expect(requests[0].fallbacks).toBeUndefined();
      expect(requests[0].betas).toBeUndefined();
    });
  });
});
