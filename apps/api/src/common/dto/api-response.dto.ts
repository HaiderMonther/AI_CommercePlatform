import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Uniform success envelope produced by the ResponseInterceptor.
 *
 * `data` is declared as a free-form object for the OpenAPI document: each endpoint
 * documents its own payload shape through its own response DTO.
 */
export class ApiSuccessResponse {
  @ApiProperty({ example: true })
  success!: true;

  @ApiProperty({ example: 'تمت العملية بنجاح' })
  message!: string;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  data!: Record<string, unknown> | null;

  @ApiPropertyOptional({ description: 'معرف التتبع للطلب' })
  correlationId?: string;
}

/** Uniform failure envelope produced by the AllExceptionsFilter. */
export class ApiErrorResponse {
  @ApiProperty({ example: false })
  success!: false;

  @ApiProperty({ example: 'حدث خطأ أثناء تنفيذ العملية' })
  message!: string;

  @ApiProperty({ example: 'VALIDATION_FAILED', description: 'رمز الخطأ الثابت' })
  code!: string;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true, example: null })
  data!: Record<string, unknown> | null;

  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'string' },
    description: 'تفاصيل أخطاء التحقق',
  })
  details?: string[];

  @ApiPropertyOptional()
  correlationId?: string;
}
