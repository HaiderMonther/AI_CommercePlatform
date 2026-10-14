import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AI_MODEL_IDS, LANGUAGES, TONES } from '../ai.constants';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class UpdateAiConfigDto {
  @ApiPropertyOptional({ description: 'تشغيل المساعد الذكي للشركة' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'الرد التلقائي على المحادثات بوضع AI' })
  @IsOptional()
  @IsBoolean()
  autoReply?: boolean;

  @ApiPropertyOptional({ example: 'متجر بغداد للأزياء' })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  @Transform(trim)
  businessName?: string;

  @ApiPropertyOptional({ description: 'وصف النشاط كما يقدّمه المساعد للزبائن' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(trim)
  businessDescription?: string;

  @ApiPropertyOptional({ enum: Object.keys(TONES) })
  @IsOptional()
  @IsIn(Object.keys(TONES), { message: 'أسلوب الرد غير صالح' })
  tone?: string;

  @ApiPropertyOptional({ enum: Object.keys(LANGUAGES) })
  @IsOptional()
  @IsIn(Object.keys(LANGUAGES), { message: 'اللغة غير مدعومة' })
  language?: string;

  @ApiPropertyOptional({ example: 'السبت - الخميس، 10 صباحاً - 10 مساءً' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(trim)
  workingHours?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1500)
  @Transform(trim)
  returnPolicy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1500)
  @Transform(trim)
  deliveryPolicy?: string;

  @ApiPropertyOptional({ enum: PaymentMethod, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsEnum(PaymentMethod, { each: true, message: 'طريقة دفع غير صالحة' })
  paymentMethods?: PaymentMethod[];

  @ApiPropertyOptional({ description: 'تعليمات إضافية خاصة بالمتجر' })
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  @Transform(trim)
  customInstructions?: string;

  @ApiPropertyOptional({ enum: AI_MODEL_IDS })
  @IsOptional()
  @IsIn(AI_MODEL_IDS, { message: 'النموذج غير متاح' })
  model?: string;

  @ApiPropertyOptional({
    description: 'كلمات تحوّل المحادثة لموظف فوراً إذا وردت في رسالة الزبون',
    example: ['موظف', 'شكوى'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @Length(2, 40, { each: true })
  handoverKeywords?: string[];
}

export class TestAiTurnDto {
  @ApiProperty({ enum: ['customer', 'assistant'] })
  @IsIn(['customer', 'assistant'])
  role!: 'customer' | 'assistant';

  @ApiProperty()
  @IsString()
  @Length(1, 2000)
  content!: string;
}

export class TestAiDto {
  @ApiProperty({ example: 'عندكم قميص أسود مقاس L؟ وشكد سعره؟' })
  @IsString()
  @Length(1, 2000)
  @Transform(trim)
  message!: string;

  @ApiPropertyOptional({ type: [TestAiTurnDto], description: 'رسائل سابقة في المحادثة التجريبية' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TestAiTurnDto)
  history?: TestAiTurnDto[];
}
