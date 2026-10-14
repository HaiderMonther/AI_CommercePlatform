import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiProviderConfig } from '@common/config/configuration';

export type AiRequest = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
export type AiResponse = Anthropic.Beta.Messages.BetaMessage;

/**
 * The one place the platform talks to the Claude API. Injectable so tests replace it and
 * never reach Anthropic.
 */
@Injectable()
export class AiClient {
  private readonly client: Anthropic | null;

  constructor(config: ConfigService) {
    const { apiKey } = config.getOrThrow<AiProviderConfig>('ai');

    // Customer chat needs a fast failure more than a long wait: the conversation is then
    // handed to a person instead of the customer waiting minutes for an answer.
    this.client = apiKey ? new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 }) : null;
  }

  get configured(): boolean {
    return this.client !== null;
  }

  async createMessage(request: AiRequest): Promise<AiResponse> {
    if (!this.client) {
      throw new Error('AI provider is not configured (AI_API_KEY is empty)');
    }
    return this.client.beta.messages.create(request);
  }
}
