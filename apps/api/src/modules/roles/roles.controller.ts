import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@common/constants/permissions.constant';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RolesService } from './roles.service';

@ApiTags('Roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ROLES_READ)
  @ResponseMessage('تم جلب الأدوار')
  @ApiOperation({ summary: 'قائمة أدوار الشركة مع صلاحياتها' })
  @ApiOkResponse({ description: 'الأدوار الافتراضية والمخصصة' })
  findAll() {
    return this.rolesService.findAll();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ROLES_READ)
  @ResponseMessage('تم جلب الدور')
  @ApiOperation({ summary: 'تفاصيل دور' })
  findOne(@Param('id') id: string) {
    return this.rolesService.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ROLES_CREATE)
  @ResponseMessage('تم إنشاء الدور بنجاح')
  @ApiOperation({ summary: 'إنشاء دور مخصص' })
  create(@Body() dto: CreateRoleDto) {
    return this.rolesService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ROLES_UPDATE)
  @ResponseMessage('تم تحديث الدور')
  @ApiOperation({ summary: 'تعديل دور مخصص أو صلاحياته' })
  update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.rolesService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.ROLES_DELETE)
  @ResponseMessage('تم حذف الدور')
  @ApiOperation({ summary: 'حذف دور مخصص غير مرتبط بمستخدمين' })
  async remove(@Param('id') id: string) {
    await this.rolesService.remove(id);
    return null;
  }
}
