import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CustomerStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateCustomerDto } from './create-customer.dto';

/** Sending `null` for an optional contact field (phone, email…) clears it. */
export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {
  @ApiPropertyOptional({
    enum: CustomerStatus,
    description: 'BLOCKED يمنع الرد عليه وبدء محادثات جديدة معه',
  })
  @IsOptional()
  @IsEnum(CustomerStatus, { message: 'حالة الزبون غير صالحة' })
  status?: CustomerStatus;
}
