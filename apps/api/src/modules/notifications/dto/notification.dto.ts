import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '@common/dto/pagination.dto';

export class QueryNotificationsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'غير المقروءة فقط' })
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' || value === true ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  unread?: boolean;
}
