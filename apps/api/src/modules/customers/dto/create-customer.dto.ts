import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { normalizePhone } from '@common/utils/phone.util';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Stores the canonical E.164 form. An unreadable number is passed through unchanged so
 * `@Matches` rejects it with a clear message instead of it being silently dropped.
 */
export const toPhone = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (normalizePhone(value) ?? value) : value;

export const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
export const PHONE_MESSAGE = 'رقم الهاتف غير صالح، مثال: 07701234567';

export class CreateCustomerDto {
  @ApiProperty({ example: 'علي حسين' })
  @IsString()
  @Length(2, 120)
  @Transform(trim)
  name!: string;

  @ApiPropertyOptional({
    example: '07701234567',
    description: 'يُخزَّن بصيغة دولية موحّدة (+9647701234567). فريد داخل الشركة.',
  })
  @IsOptional()
  @Transform(toPhone)
  @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
  phone?: string;

  @ApiPropertyOptional({ example: '07801234567' })
  @IsOptional()
  @Transform(toPhone)
  @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
  altPhone?: string;

  @ApiPropertyOptional({ example: 'ali@example.com' })
  @IsOptional()
  @IsEmail({}, { message: 'البريد الإلكتروني غير صالح' })
  @MaxLength(160)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email?: string;

  @ApiPropertyOptional({ example: 'حي المنصور، قرب جامع الرحمن' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(trim)
  address?: string;

  @ApiPropertyOptional({ example: 'بغداد' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trim)
  city?: string;

  @ApiPropertyOptional({ description: 'ملاحظات داخلية لا تظهر للزبون' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ type: [String], example: ['جملة', 'زبون دائم'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];
}
