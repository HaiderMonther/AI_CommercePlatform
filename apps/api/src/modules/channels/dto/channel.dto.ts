import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChannelType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateChannelDto {
  @ApiProperty({ enum: ChannelType })
  @IsEnum(ChannelType, { message: 'نوع القناة غير صالح' })
  type!: ChannelType;

  @ApiProperty({ example: 'واتساب المتجر' })
  @IsString()
  @Length(2, 80)
  @Transform(trim)
  name!: string;

  @ApiProperty({
    description: 'واتساب: Phone number ID · ماسنجر: Page ID · إنستغرام: Instagram account ID',
    example: '106540352242922',
  })
  @IsString()
  @Transform(trim)
  @Matches(/^\d{5,25}$/, { message: 'معرف الحساب يتكون من أرقام فقط كما يظهر في لوحة Meta' })
  externalId!: string;

  @ApiProperty({ description: 'رمز وصول دائم (System User token أو Page token). يُخزَّن مشفّراً.' })
  @IsString()
  @Length(20, 1024, { message: 'رمز الوصول غير صالح' })
  @Transform(trim)
  accessToken!: string;
}

export class UpdateChannelDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 80)
  @Transform(trim)
  name?: string;

  @ApiPropertyOptional({ description: 'استبدال رمز الوصول؛ يُعاد التحقق من الاتصال تلقائياً' })
  @IsOptional()
  @IsString()
  @Length(20, 1024, { message: 'رمز الوصول غير صالح' })
  @Transform(trim)
  accessToken?: string;

  @ApiPropertyOptional({ description: 'القناة الموقوفة تتجاهل الرسائل الواردة ولا ترسل' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
