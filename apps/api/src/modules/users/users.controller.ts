import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { PERMISSIONS } from '@common/constants/permissions.constant';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { ApiErrorResponse } from '@common/dto/api-response.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { ResetUserPasswordDto, UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@ApiForbiddenResponse({ type: ApiErrorResponse, description: 'PERMISSION_DENIED' })
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_READ)
  @ResponseMessage('تم جلب المستخدمين')
  @ApiOperation({ summary: 'قائمة مستخدمي الشركة' })
  @ApiOkResponse({ description: 'قائمة مقسمة بالصفحات' })
  findAll(@Query() query: QueryUsersDto) {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.USERS_READ)
  @ResponseMessage('تم جلب بيانات المستخدم')
  @ApiOperation({ summary: 'تفاصيل مستخدم' })
  @ApiParam({ name: 'id', description: 'معرف المستخدم' })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.USERS_CREATE)
  @ResponseMessage('تم إنشاء المستخدم بنجاح')
  @ApiOperation({ summary: 'إضافة مستخدم جديد للشركة' })
  @ApiCreatedResponse({ description: 'المستخدم بعد الإنشاء' })
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.USERS_UPDATE)
  @ResponseMessage('تم تحديث المستخدم')
  @ApiOperation({ summary: 'تعديل بيانات مستخدم أو دوره أو حالته' })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.USERS_UPDATE)
  @ResponseMessage('تم تغيير كلمة مرور المستخدم')
  @ApiOperation({ summary: 'إعادة تعيين كلمة مرور مستخدم وإنهاء جلساته' })
  async resetPassword(@Param('id') id: string, @Body() dto: ResetUserPasswordDto) {
    await this.usersService.resetPassword(id, dto);
    return null;
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.USERS_DELETE)
  @ResponseMessage('تم حذف المستخدم')
  @ApiOperation({ summary: 'حذف مستخدم (حذف ناعم مع الاحتفاظ بالسجل)' })
  async remove(@Param('id') id: string) {
    await this.usersService.remove(id);
    return null;
  }
}
