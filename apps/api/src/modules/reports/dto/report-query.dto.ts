import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

/** A period in the company's calendar; defaults to the last 30 days including today. */
export class ReportQueryDto {
  @ApiPropertyOptional({ example: '2026-09-15', description: 'أول يوم (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  @Length(10, 10)
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-14', description: 'آخر يوم، ضمناً (YYYY-MM-DD)' })
  @IsOptional()
  @IsString()
  @Length(10, 10)
  to?: string;
}
