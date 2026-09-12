import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export class RegisterCompanyDto {
  @ApiProperty({ example: 'متجر بغداد للأزياء' })
  @IsString()
  @MinLength(2, { message: 'اسم الشركة قصير جداً' })
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  companyName!: string;

  @ApiProperty({ example: 'حيدر منذر' })
  @IsString()
  @MinLength(2, { message: 'الاسم قصير جداً' })
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  fullName!: string;

  @ApiProperty({ example: 'owner@demo-store.iq' })
  @IsEmail({}, { message: 'البريد الإلكتروني غير صالح' })
  @MaxLength(160)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  email!: string;

  @ApiProperty({ example: 'Demo@12345' })
  @IsString()
  @Matches(PASSWORD_RULE, {
    message: 'كلمة المرور يجب أن تحتوي على 8 أحرف على الأقل مع حرف كبير وحرف صغير ورقم',
  })
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({ example: '+9647701234567' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(/^\+?[0-9\s-]{7,}$/, { message: 'رقم الهاتف غير صالح' })
  phone?: string;
}
