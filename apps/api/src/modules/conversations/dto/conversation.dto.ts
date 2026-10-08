import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChannelType, ConversationMode, ConversationStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '@common/dto/pagination.dto';

const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};

export class QueryConversationsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ConversationStatus })
  @IsOptional()
  @IsEnum(ConversationStatus)
  status?: ConversationStatus;

  @ApiPropertyOptional({ description: 'المحادثات المفتوحة والمعلّقة فقط (صندوق الوارد)' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ enum: ConversationMode })
  @IsOptional()
  @IsEnum(ConversationMode)
  mode?: ConversationMode;

  @ApiPropertyOptional({ enum: ChannelType })
  @IsOptional()
  @IsEnum(ChannelType)
  channel?: ChannelType;

  @ApiPropertyOptional({
    description: '`me` للمسندة إليّ، `unassigned` لغير المسندة، أو معرف مستخدم',
    example: 'me',
  })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  assignee?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 40)
  customerId?: string;

  @ApiPropertyOptional({ description: 'التي فيها رسائل غير مقروءة فقط' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  unread?: boolean;
}

export class CreateConversationDto {
  @ApiProperty()
  @IsString()
  @Length(1, 40)
  customerId!: string;

  @ApiProperty({ enum: ChannelType })
  @IsEnum(ChannelType, { message: 'القناة غير صالحة' })
  channel!: ChannelType;

  @ApiPropertyOptional({ example: 'متابعة طلب سابق' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  subject?: string;
}

export class AssignConversationDto {
  @ApiProperty({ nullable: true, description: 'معرف الموظف، أو null لإلغاء الإسناد' })
  @ValidateIf((dto: AssignConversationDto) => dto.userId !== null)
  @IsString({ message: 'معرف الموظف مطلوب، أو null لإلغاء الإسناد' })
  @Length(1, 40)
  userId!: string | null;
}

export class UpdateConversationStatusDto {
  @ApiProperty({ enum: ConversationStatus })
  @IsEnum(ConversationStatus, { message: 'حالة المحادثة غير صالحة' })
  status!: ConversationStatus;
}

export class UpdateConversationModeDto {
  @ApiProperty({ enum: ConversationMode, description: 'AI للرد الآلي، HUMAN لموظف' })
  @IsEnum(ConversationMode, { message: 'وضع المحادثة غير صالح' })
  mode!: ConversationMode;

  @ApiPropertyOptional({ example: 'الزبون طلب التحدث مع موظف' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
