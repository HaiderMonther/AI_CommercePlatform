import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CompanyStatus, InvoiceStatus, PlanTier } from '@prisma/client';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '@common/dto/pagination.dto';

export class ChangePlanDto {
  @ApiProperty({ enum: PlanTier })
  @IsEnum(PlanTier, { message: 'الباقة غير صالحة' })
  tier!: PlanTier;
}

export class CancelSubscriptionDto {
  @ApiProperty({ description: 'true لإيقاف التجديد بنهاية الفترة، false للتراجع عن ذلك' })
  @IsBoolean()
  cancel!: boolean;
}

export class QueryCompaniesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CompanyStatus })
  @IsOptional()
  @IsEnum(CompanyStatus)
  status?: CompanyStatus;
}

export class QueryInvoicesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: InvoiceStatus })
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;
}

export class UpdateCompanyStatusDto {
  @ApiProperty({ enum: [CompanyStatus.ACTIVE, CompanyStatus.SUSPENDED] })
  @IsIn([CompanyStatus.ACTIVE, CompanyStatus.SUSPENDED], {
    message: 'الحالة المسموحة: ACTIVE أو SUSPENDED',
  })
  status!: CompanyStatus;
}

export class UpdateCompanySubscriptionDto {
  @ApiPropertyOptional({ enum: PlanTier, description: 'نقل المتجر لباقة دون فحص التخفيض' })
  @IsOptional()
  @IsEnum(PlanTier)
  tier?: PlanTier;

  @ApiPropertyOptional({ description: 'تمديد الفترة الحالية (أو التجريبية) بعدد أيام', example: 7 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  extendDays?: number;
}
