import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateProductDto } from './create-product.dto';

/**
 * Stock is intentionally not editable here. Changing it must go through
 * POST /inventory/adjust so the change is recorded as a movement with a reason.
 */
export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ['initialStock'] as const),
) {}
