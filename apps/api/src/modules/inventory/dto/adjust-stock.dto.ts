import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InventoryMovementType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

/** Movement types an operator may trigger by hand. SALE, RESERVATION and RELEASE are
 *  produced by the order flow only, so they are deliberately not offered here. */
export const MANUAL_MOVEMENT_TYPES = [
  InventoryMovementType.STOCK_IN,
  InventoryMovementType.STOCK_OUT,
  InventoryMovementType.ADJUSTMENT,
  InventoryMovementType.RETURN,
] as const;

export class AdjustStockDto {
  @ApiProperty({ description: 'معرف المنتج' })
  @IsString()
  @Length(1, 40)
  productId!: string;

  @ApiPropertyOptional({ description: 'معرف المتغير إن كان المنتج بمتغيرات' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  variantId?: string;

  @ApiProperty({ enum: MANUAL_MOVEMENT_TYPES })
  @IsEnum(InventoryMovementType)
  type!: (typeof MANUAL_MOVEMENT_TYPES)[number];

  @ApiProperty({
    description:
      'الكمية. للإدخال والإخراج والإرجاع: مقدار التغيير. للجرد (ADJUSTMENT): الكمية النهائية الصحيحة.',
    example: 10,
  })
  @IsInt({ message: 'الكمية يجب أن تكون رقماً صحيحاً' })
  @Min(0)
  @Max(1_000_000)
  quantity!: number;

  @ApiPropertyOptional({ description: 'سبب الحركة، يظهر في سجل المخزون' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
