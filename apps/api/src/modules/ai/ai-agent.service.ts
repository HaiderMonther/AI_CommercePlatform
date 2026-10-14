import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, UsageMetric } from '@prisma/client';
import { PrismaService } from '@common/prisma/prisma.service';
import { AiClient, AiRequest, AiResponse } from './ai-client';
import { AgentProfile, CustomerContext, buildContextBlock, buildSystemPrompt } from './ai-prompt';
import { AI_TOOLS, AiToolExecutor, ToolContext } from './ai-tools';
import { HANDOVER, MAX_REPLY_LENGTH, MAX_TOOL_ROUNDS, MODELS_WITH_FALLBACK } from './ai.constants';

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ToolResultParam = Anthropic.Beta.Messages.BetaToolResultBlockParam;

/** Output budget per request. Thinking counts against it, so it is not set tight. */
const MAX_TOKENS = 16_000;

export interface AgentRunInput {
  companyId: string;
  model: string;
  profile: AgentProfile;
  customer: CustomerContext;
  history: MessageParam[];
  tools: ToolContext;
}

export interface AgentToolCall {
  name: string;
  input: unknown;
  isError: boolean;
}

export interface AgentRunResult {
  /** Text to send to the customer, if any. */
  reply: string | null;
  /** Set when the conversation must go to a person. */
  handoverReason: string | null;
  toolCalls: AgentToolCall[];
  orderIds: string[];
  /** The model that actually answered (differs from the requested one after a fallback). */
  model: string;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  latencyMs: number;
  success: boolean;
  error: string | null;
  interactionId: string;
}

/**
 * Runs the sales agent for one turn: Claude reads the conversation, calls tools as it
 * needs, and ends with the reply to send. Every run is recorded as an AiInteraction with
 * its token usage, whatever the outcome.
 *
 * The loop appends each response unchanged and never edits earlier turns, which keeps
 * the prompt cache warm and the model's thinking valid across tool rounds.
 */
@Injectable()
export class AiAgentService {
  private readonly logger = new Logger(AiAgentService.name);

  constructor(
    private readonly client: AiClient,
    private readonly tools: AiToolExecutor,
    private readonly prisma: PrismaService,
  ) {}

  get configured(): boolean {
    return this.client.configured;
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const started = Date.now();
    const messages: MessageParam[] = [...input.history];
    const toolCalls: AgentToolCall[] = [];
    const orderIds: string[] = [];
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

    let reply: string | null = null;
    let handoverReason: string | null = null;
    let error: string | null = null;
    let answeredBy = input.model;

    const system = [
      // Same for every conversation of the company: cached across all of them.
      {
        type: 'text' as const,
        text: buildSystemPrompt(input.profile),
        cache_control: { type: 'ephemeral' as const },
      },
      { type: 'text' as const, text: buildContextBlock(input.customer, new Date()) },
    ];

    try {
      for (let round = 0; ; round++) {
        if (round >= MAX_TOOL_ROUNDS) {
          handoverReason = HANDOVER.TOO_MANY_STEPS;
          break;
        }

        const response = await this.client.createMessage(
          this.request(input.model, system, messages),
        );
        answeredBy = response.model;
        this.addUsage(usage, response);

        if (response.stop_reason === 'refusal') {
          this.logger.warn(
            `Refusal (${response.stop_details?.category ?? 'uncategorized'}) in conversation ${input.tools.conversationId ?? 'test'}`,
          );
          handoverReason = HANDOVER.REFUSAL;
          break;
        }

        if (response.stop_reason === 'max_tokens') {
          throw new Error('Reply hit the max_tokens limit');
        }

        messages.push({ role: 'assistant', content: response.content });

        const calls = response.content.filter(
          (block): block is Anthropic.Beta.Messages.BetaToolUseBlock => block.type === 'tool_use',
        );

        if (response.stop_reason !== 'tool_use' || calls.length === 0) {
          reply = this.textOf(response);
          break;
        }

        // Every result goes back in one user message, so parallel calls stay parallel.
        const results: ToolResultParam[] = [];
        for (const call of calls) {
          const outcome = await this.tools.execute(call.name, call.input, input.tools);
          toolCalls.push({ name: call.name, input: call.input, isError: outcome.isError });
          if (outcome.orderId) orderIds.push(outcome.orderId);
          if (outcome.handoverReason) handoverReason = outcome.handoverReason;

          results.push({
            type: 'tool_result',
            tool_use_id: call.id,
            content: outcome.content,
            ...(outcome.isError ? { is_error: true } : {}),
          });
        }
        messages.push({ role: 'user', content: results });
      }
    } catch (caught) {
      error = this.describe(caught);
      handoverReason = HANDOVER.FAILURE;
      this.logger.error(`Agent run failed: ${error}`);
    }

    const latencyMs = Date.now() - started;
    const success = error === null;

    const interactionId = await this.record(input, {
      model: answeredBy,
      usage,
      latencyMs,
      toolCalls,
      success,
      error,
      intent: handoverReason
        ? 'handover'
        : orderIds.length
          ? 'create_order'
          : (toolCalls.at(-1)?.name ?? 'reply'),
    });

    return {
      reply: reply ? reply.slice(0, MAX_REPLY_LENGTH) : null,
      handoverReason,
      toolCalls,
      orderIds,
      model: answeredBy,
      usage,
      latencyMs,
      success,
      error,
      interactionId,
    };
  }

  private request(model: string, system: AiRequest['system'], messages: MessageParam[]): AiRequest {
    const fallback = MODELS_WITH_FALLBACK.has(model);

    return {
      model,
      max_tokens: MAX_TOKENS,
      // Thinking stays at the model's adaptive default; effort is the depth control.
      // Sales chat rarely needs deep reasoning, and lower effort answers sooner.
      output_config: { effort: 'medium' },
      system,
      tools: AI_TOOLS,
      // Caches the growing conversation between tool rounds of the same reply.
      cache_control: { type: 'ephemeral' },
      messages,
      // A declined request is retried server-side on the model Anthropic recommends for
      // that refusal category, instead of reaching the customer as silence.
      ...(fallback
        ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
        : {}),
    };
  }

  private textOf(response: AiResponse): string | null {
    const text = response.content
      .filter((block): block is Anthropic.Beta.Messages.BetaTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    return text || null;
  }

  private addUsage(total: AgentRunResult['usage'], response: AiResponse): void {
    total.input += response.usage.input_tokens;
    total.output += response.usage.output_tokens;
    total.cacheRead += response.usage.cache_read_input_tokens ?? 0;
    total.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;
  }

  private describe(error: unknown): string {
    if (error instanceof Anthropic.RateLimitError) return 'Claude API rate limit reached';
    if (error instanceof Anthropic.AuthenticationError) return 'Claude API key is invalid';
    if (error instanceof Anthropic.BadRequestError)
      return `Claude API rejected the request: ${error.message}`;
    if (error instanceof Anthropic.APIConnectionError) return 'Claude API unreachable';
    if (error instanceof Anthropic.APIError)
      return `Claude API error ${error.status}: ${error.message}`;
    return error instanceof Error ? error.message : String(error);
  }

  /** Writes the interaction and adds to the company's daily usage counters. */
  private async record(
    input: AgentRunInput,
    run: {
      model: string;
      usage: AgentRunResult['usage'];
      latencyMs: number;
      toolCalls: AgentToolCall[];
      success: boolean;
      error: string | null;
      intent: string;
    },
  ): Promise<string> {
    const promptTokens = run.usage.input + run.usage.cacheRead + run.usage.cacheWrite;

    const interaction = await this.prisma.aiInteraction.create({
      data: {
        companyId: input.companyId,
        conversationId: input.tools.conversationId,
        intent: run.intent,
        model: run.model,
        promptTokens,
        completionTokens: run.usage.output,
        totalTokens: promptTokens + run.usage.output,
        latencyMs: run.latencyMs,
        toolCalls: run.toolCalls as unknown as Prisma.InputJsonValue,
        success: run.success,
        error: run.error?.slice(0, 1000) ?? null,
      },
      select: { id: true },
    });

    if (!input.tools.dryRun) {
      await this.addDailyUsage(input.companyId, UsageMetric.AI_MESSAGES, 1);
      await this.addDailyUsage(
        input.companyId,
        UsageMetric.AI_TOKENS,
        promptTokens + run.usage.output,
      );
    }

    return interaction.id;
  }

  private async addDailyUsage(
    companyId: string,
    metric: UsageMetric,
    value: number,
  ): Promise<void> {
    if (value <= 0) return;
    const period = new Date().toISOString().slice(0, 10);

    try {
      await this.prisma.usageRecord.upsert({
        where: { companyId_metric_period: { companyId, metric, period } },
        create: { companyId, metric, period, value },
        update: { value: { increment: value } },
      });
    } catch (error) {
      // Two first-of-the-day upserts race on create; the loser adds onto the winner's row.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        await this.prisma.usageRecord.update({
          where: { companyId_metric_period: { companyId, metric, period } },
          data: { value: { increment: value } },
        });
        return;
      }
      this.logger.error(
        `Usage counter ${metric} not updated`,
        error instanceof Error ? error.stack : '',
      );
    }
  }
}
