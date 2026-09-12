import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@common/constants/permissions.constant';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { PermissionsService } from './permissions.service';

@ApiTags('Permissions')
@ApiBearerAuth()
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ROLES_READ)
  @ResponseMessage('تم جلب الصلاحيات')
  @ApiOperation({ summary: 'قائمة الصلاحيات المتاحة مجمّعة حسب القسم' })
  @ApiOkResponse({ description: 'مصفوفة الصلاحيات المستخدمة في شاشة الأدوار' })
  findAll() {
    return this.permissionsService.findAllGrouped();
  }
}
