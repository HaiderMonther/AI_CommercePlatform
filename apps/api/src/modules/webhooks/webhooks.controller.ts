import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseEnumPipe,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '@common/decorators/public.decorator';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { WebhookProcessorService } from './webhook-processor.service';
import { WebhooksService } from './webhooks.service';

/** One path per channel, as configured in the Meta app; all share the same handling. */
enum WebhookChannel {
  WHATSAPP = 'whatsapp',
  INSTAGRAM = 'instagram',
  FACEBOOK = 'facebook',
}

const channelPipe = new ParseEnumPipe(WebhookChannel);

/**
 * Public endpoints Meta calls. Authenticity comes from the payload signature, not from
 * a token, and throttling is off: Meta delivers in bursts and a 429 only makes it retry.
 */
@ApiTags('Webhooks')
@Public()
// Both named throttlers: a bare @SkipThrottle() only skips `default`.
@SkipThrottle({ default: true, auth: true })
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly processor: WebhookProcessorService,
  ) {}

  @Get(':channel')
  @ApiOperation({ summary: 'تحقق Meta من عنوان الـwebhook (hub.challenge)' })
  @ApiParam({ name: 'channel', enum: WebhookChannel })
  verify(
    @Param('channel', channelPipe) _channel: WebhookChannel,
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() res: Response,
  ): void {
    // Meta expects the bare challenge back, not the JSON envelope.
    if (this.webhooks.verifySubscription(mode, token) && challenge) {
      res.status(200).type('text/plain').send(challenge);
      return;
    }
    res.status(403).type('text/plain').send('Forbidden');
  }

  @Post(':channel')
  @HttpCode(200)
  @ResponseMessage('تم استلام الحدث')
  @ApiExcludeEndpoint()
  async receive(
    @Param('channel', channelPipe) _channel: WebhookChannel,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() body: unknown,
  ) {
    const result = await this.webhooks.ingest(req.rawBody, signature, body);

    // After the 200 has gone out; the sweep catches anything this misses.
    if (result.queued.length > 0) {
      setImmediate(() => void this.processor.processMany(result.queued));
    }

    return { received: result.received, queued: result.queued.length };
  }
}
