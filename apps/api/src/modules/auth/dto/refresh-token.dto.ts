import { ApiProperty } from '@nestjs/swagger';
import { IsJWT, IsNotEmpty } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ description: 'رمز التحديث المستلم عند تسجيل الدخول' })
  @IsNotEmpty({ message: 'رمز التحديث مطلوب' })
  @IsJWT({ message: 'رمز التحديث غير صالح' })
  refreshToken!: string;
}
