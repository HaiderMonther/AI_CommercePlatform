import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateVariantDto {
  @ApiProperty({
    description: 'خصائص المتغير، مثل اللون والمقاس',
    example: { color: 'أسود', size: 'L' },
  })
  @IsObject({ message: 'خصائص المتغير يجب أن تكون كائناً' })
  attributes!: Record<string, string>;

  @ApiPropertyOptional({
    description: 'اسم المتغير. يُشتق من الخصائص إن لم يُرسل، مثل "أسود / L".',
  })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name?: string;

  @ApiPropertyOptional({ description: 'رمز المتغير. يُولَّد من رمز المنتج إن لم يُرسل.' })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  sku?: string;

  @ApiPropertyOptional({ description: 'سعر خاص بالمتغير، وإلا يُستخدم سعر المنتج' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(9_999_999_999)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(9_999_999_999)
  salePrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(9_999_999_999)
  costPrice?: number;

  @ApiPropertyOptional({ default: 0, description: 'الكمية الابتدائية، تُسجَّل كحركة إدخال' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  initialStock?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({}, { message: 'رابط الصورة غير صالح' })
  @MaxLength(500)
  imageUrl?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Stock is excluded: it changes only through the inventory module. */
export class UpdateVariantDto {
  @ApiPropertyOptional({ example: { color: 'أبيض', size: 'M' } })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(9_999_999_999)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(9_999_999_999)
  salePrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(9_999_999_999)
  costPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({}, { message: 'رابط الصورة غير صالح' })
  @MaxLength(500)
  imageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
