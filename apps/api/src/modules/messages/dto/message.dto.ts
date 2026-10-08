import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export const DEFAULT_MESSAGE_PAGE = 50;

/**
 * Cursor pagination: a chat thread grows at the end while it is being read, so page
 * numbers would shift under the reader. `before` anchors on a message id instead.
 */
export class QueryMessagesDto {
  @ApiPropertyOptional({ description: 'معرف أقدم رسالة معروضة؛ تُرجع الرسائل التي قبلها' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  before?: string;

  @ApiPropertyOptional({ default: DEFAULT_MESSAGE_PAGE, maximum: 100 })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === '' ? DEFAULT_MESSAGE_PAGE : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = DEFAULT_MESSAGE_PAGE;
}

export class SendMessageDto {
  @ApiProperty({ example: 'هلا بيك، القطعة متوفرة بالمقاس L' })
  @IsString()
  // WhatsApp's text limit; the other channels allow at least as much.
  @Length(1, 4096, { message: 'نص الرسالة يجب أن يكون بين 1 و 4096 حرفاً' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  content!: string;
}
