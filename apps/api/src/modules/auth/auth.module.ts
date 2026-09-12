import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { CompaniesModule } from '@modules/companies/companies.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { PrincipalService } from './principal.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenService } from './token.service';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({}), CompaniesModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, PrincipalService, JwtStrategy],
  exports: [AuthService, PasswordService, PrincipalService, TokenService],
})
export class AuthModule {}
