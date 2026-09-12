import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { ALL_PERMISSIONS } from '@common/constants/permissions.constant';

export class CreateRoleDto {
  @ApiProperty({ example: 'Warehouse Keeper' })
  @IsString()
  @Length(2, 60)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @ApiProperty({ example: 'أمين المخزن' })
  @IsString()
  @Length(2, 60)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  nameAr!: string;

  @ApiPropertyOptional({ example: 'إدارة المخزون فقط' })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  description?: string;

  @ApiProperty({
    type: [String],
    example: ['products.read', 'inventory.read', 'inventory.adjust'],
    description: 'قائمة مفاتيح الصلاحيات',
  })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(200)
  @IsIn(ALL_PERMISSIONS, { each: true, message: 'صلاحية غير معروفة' })
  permissions!: string[];
}
