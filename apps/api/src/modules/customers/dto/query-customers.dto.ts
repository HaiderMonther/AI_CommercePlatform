import { ApiPropertyOptional } from '@nestjs/swagger';
import { ChannelType, CustomerStatus } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '@common/dto/pagination.dto';

export const CUSTOMER_SORT_FIELDS = [
  'createdAt',
  'name',
  'lastContactAt',
  'totalSpent',
  'totalOrders',
] as const;

export class QueryCustomersDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CustomerStatus })
  @IsOptional()
  @IsEnum(CustomerStatus)
  status?: CustomerStatus;

  @ApiPropertyOptional({ enum: ChannelType, description: 'زبائن لديهم هوية على هذه القناة' })
  @IsOptional()
  @IsEnum(ChannelType)
  channel?: ChannelType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  tag?: string;

  @ApiPropertyOptional({ enum: CUSTOMER_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(CUSTOMER_SORT_FIELDS)
  sortBy: (typeof CUSTOMER_SORT_FIELDS)[number] = 'createdAt';
}
