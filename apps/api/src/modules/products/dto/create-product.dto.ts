import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ProductImageDto {
  @ApiProperty()
  @IsUrl({}, { message: 'رابط الصورة غير صالح' })
  @MaxLength(500)
  url!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  alt?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class CreateProductDto {
  @ApiProperty({ example: 'قميص قطني رجالي' })
  @IsString()
  @Length(2, 160)
  @Transform(trim)
  name!: string;

  @ApiPropertyOptional({
    description: 'رمز المنتج. يُولَّد تلقائياً إن لم يُرسل.',
    example: 'SHIRT-001',
  })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  sku?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: 25000, description: 'سعر البيع' })
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'السعر غير صالح' })
  @Min(0)
  @Max(9_999_999_999)
  price!: number;

  @ApiPropertyOptional({ example: 20000, description: 'سعر بعد الخصم' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(9_999_999_999)
  salePrice?: number;

  @ApiPropertyOptional({ example: 15000, description: 'سعر التكلفة، لا يظهر للزبون' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(9_999_999_999)
  costPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 40)
  categoryId?: string;

  @ApiPropertyOptional({
    default: 0,
    description: 'الكمية الابتدائية. تُسجَّل كحركة إدخال مخزون.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  initialStock?: number;

  @ApiPropertyOptional({ default: 5, description: 'حد التنبيه لانخفاض المخزون' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  lowStockThreshold?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  trackInventory?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: [String], example: ['صيفي', 'قطن'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: [ProductImageDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images?: ProductImageDto[];
}
