import { ApiProperty } from '@nestjs/swagger';

export class AuthUserDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() fullName!: string;
  @ApiProperty({ nullable: true }) avatarUrl!: string | null;
  @ApiProperty({ nullable: true }) companyId!: string | null;
  @ApiProperty() isPlatformAdmin!: boolean;
  @ApiProperty({ nullable: true }) roleKey!: string | null;
  @ApiProperty({ nullable: true }) roleName!: string | null;
  @ApiProperty({ type: [String] }) permissions!: string[];
}

export class AuthCompanyDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() status!: string;
  @ApiProperty() planTier!: string;
  @ApiProperty({ nullable: true }) logoUrl!: string | null;
}

export class AuthTokensDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ description: 'مدة صلاحية رمز الدخول بالثواني' }) expiresIn!: number;
}

export class LoginResponseDto {
  @ApiProperty({ type: AuthUserDto }) user!: AuthUserDto;
  @ApiProperty({ type: AuthCompanyDto, nullable: true }) company!: AuthCompanyDto | null;
  @ApiProperty({ type: AuthTokensDto }) tokens!: AuthTokensDto;
}
