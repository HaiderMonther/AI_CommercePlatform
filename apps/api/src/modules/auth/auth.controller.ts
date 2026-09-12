import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Public } from '@common/decorators/public.decorator';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { ApiErrorResponse } from '@common/dto/api-response.dto';
import { AuthenticatedUser } from '@common/types/authenticated-user.type';
import { AuthService } from './auth.service';
import { LoginResponseDto } from './dto/auth-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterCompanyDto } from './dto/register-company.dto';
import { SessionMetadata } from './token.service';

const AUTH_THROTTLE = { auth: { limit: 10, ttl: 60_000 } };

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @Throttle(AUTH_THROTTLE)
  @ResponseMessage('تم إنشاء الحساب بنجاح')
  @ApiOperation({ summary: 'تسجيل شركة جديدة مع حساب المالك' })
  @ApiBody({ type: RegisterCompanyDto })
  @ApiOkResponse({ type: LoginResponseDto })
  register(@Body() dto: RegisterCompanyDto, @Req() request: Request) {
    return this.authService.register(dto, sessionMetadata(request));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  @ResponseMessage('تم تسجيل الدخول بنجاح')
  @ApiOperation({ summary: 'تسجيل الدخول والحصول على رموز الجلسة' })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse, description: 'INVALID_CREDENTIALS' })
  @ApiTooManyRequestsResponse({ type: ApiErrorResponse, description: 'RATE_LIMITED' })
  login(@Body() dto: LoginDto, @Req() request: Request) {
    return this.authService.login(dto, sessionMetadata(request));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  @ResponseMessage('تم تجديد الجلسة')
  @ApiOperation({ summary: 'تجديد رمز الدخول باستخدام رمز التحديث' })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse, description: 'TOKEN_INVALID أو REFRESH_TOKEN_REUSED' })
  refresh(@Body() dto: RefreshTokenDto, @Req() request: Request) {
    return this.authService.refresh(dto.refreshToken, sessionMetadata(request));
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ResponseMessage('تم تسجيل الخروج')
  @ApiOperation({ summary: 'إنهاء الجلسة الحالية وإبطال رمز التحديث' })
  async logout(@Body() dto: Partial<RefreshTokenDto>, @CurrentUser() user: AuthenticatedUser) {
    await this.authService.logout(dto?.refreshToken, user);
    return null;
  }

  @Get('me')
  @ApiBearerAuth()
  @ResponseMessage('تم جلب بيانات الحساب')
  @ApiOperation({ summary: 'بيانات المستخدم الحالي وصلاحياته' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getProfile(user);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ResponseMessage('تم تغيير كلمة المرور، الرجاء تسجيل الدخول مرة أخرى')
  @ApiOperation({ summary: 'تغيير كلمة المرور وإبطال جميع الجلسات' })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.authService.changePassword(user, dto);
    return null;
  }
}

function sessionMetadata(request: Request): SessionMetadata {
  return {
    ipAddress: request.ip,
    userAgent: request.get('user-agent') ?? undefined,
  };
}
