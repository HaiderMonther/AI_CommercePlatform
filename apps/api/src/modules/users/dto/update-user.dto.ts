import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

/**
 * Email is intentionally immutable: it is the login identity and is referenced by the
 * audit trail. Password is reset through its own endpoint so the change can be audited.
 */
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['email', 'password'] as const),
) {
  @ApiPropertyOptional({ description: 'رابط الصورة الشخصية' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarUrl?: string;
}

export class ResetUserPasswordDto {
  @ApiPropertyOptional({ example: 'NewPass@123' })
  @IsString()
  @Matches(PASSWORD_RULE, {
    message: 'كلمة المرور يجب أن تحتوي على 8 أحرف على الأقل مع حرف كبير وحرف صغير ورقم',
  })
  @MaxLength(128)
  newPassword!: string;
}
