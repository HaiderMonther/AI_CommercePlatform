import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeliveryStatus, OrderSource, OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '@common/dto/pagination.dto';
import { PHONE_MESSAGE, PHONE_PATTERN, toPhone } from '@modules/customers/dto/create-customer.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};

const MAX_MONEY = 9_999_999_999;

export class OrderItemInputDto {
  @ApiProperty()
  @IsString()
  @Length(1, 40)
  productId!: string;

  @ApiPropertyOptional({ description: 'مطلوب إذا كان للمنتج متغيرات (لون/مقاس)' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  variantId?: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt({ message: 'الكمية يجب أن تكون رقماً صحيحاً' })
  @Min(1)
  @Max(10_000)
  quantity!: number;

  @ApiPropertyOptional({
    description: 'سعر الوحدة. يُؤخذ من الكتالوج (سعر التخفيض إن وُجد) إذا لم يُرسل.',
    example: 25000,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(MAX_MONEY)
  unitPrice?: number;

  @ApiPropertyOptional({ description: 'خصم على السطر كاملاً', example: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(MAX_MONEY)
  discount?: number;
}

/** A customer created (or matched by phone) on the fly while placing the order. */
export class OrderCustomerInputDto {
  @ApiProperty({ example: 'علي حسين' })
  @IsString()
  @Length(2, 120)
  @Transform(trim)
  name!: string;

  @ApiProperty({ example: '07701234567', description: 'إن وُجد زبون بنفس الرقم يُربط الطلب به' })
  @Transform(toPhone)
  @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
  phone!: string;

  @ApiPropertyOptional({ example: 'بغداد' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trim)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(trim)
  address?: string;
}

export class CreateOrderDto {
  @ApiPropertyOptional({ description: 'زبون موجود. أرسل هذا أو `customer`.' })
  @ValidateIf((dto: CreateOrderDto) => !dto.customer)
  @IsString({ message: 'حدّد الزبون' })
  @Length(1, 40)
  customerId?: string;

  @ApiPropertyOptional({ type: OrderCustomerInputDto })
  @ValidateIf((dto: CreateOrderDto) => !dto.customerId)
  @ValidateNested()
  @Type(() => OrderCustomerInputDto)
  customer?: OrderCustomerInputDto;

  @ApiPropertyOptional({ description: 'المحادثة التي جاء منها الطلب' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  conversationId?: string;

  @ApiProperty({ type: [OrderItemInputDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'أضف منتجاً واحداً على الأقل' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items!: OrderItemInputDto[];

  @ApiPropertyOptional({ enum: PaymentMethod, default: PaymentMethod.CASH_ON_DELIVERY })
  @IsOptional()
  @IsEnum(PaymentMethod, { message: 'طريقة الدفع غير صالحة' })
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ description: 'خصم على الطلب كاملاً', example: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(MAX_MONEY)
  discount?: number;

  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(MAX_MONEY)
  deliveryFee?: number;

  @ApiPropertyOptional({ description: 'الافتراضي هاتف الزبون' })
  @IsOptional()
  @Transform(toPhone)
  @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
  customerPhone?: string;

  @ApiPropertyOptional({ description: 'الافتراضي اسم الزبون' })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  @Transform(trim)
  customerName?: string;

  @ApiPropertyOptional({ description: 'الافتراضي عنوان الزبون' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(trim)
  deliveryAddress?: string;

  @ApiPropertyOptional({ description: 'الافتراضي مدينة الزبون' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trim)
  deliveryCity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/** Order details that can change after placement. Lines go through `PUT /:id/items`. */
export class UpdateOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 120)
  @Transform(trim)
  customerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toPhone)
  @Matches(PHONE_PATTERN, { message: PHONE_MESSAGE })
  customerPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  @Transform(trim)
  deliveryAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(trim)
  deliveryCity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod, { message: 'طريقة الدفع غير صالحة' })
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ description: 'قبل الشحن فقط' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(MAX_MONEY)
  discount?: number;

  @ApiPropertyOptional({ description: 'قبل الشحن فقط' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(MAX_MONEY)
  deliveryFee?: number;

  @ApiPropertyOptional({
    enum: DeliveryStatus,
    description: 'PENDING · ASSIGNED · IN_TRANSIT · FAILED. الباقي يتبع حالة الطلب تلقائياً.',
  })
  @IsOptional()
  @IsEnum(DeliveryStatus, { message: 'حالة التوصيل غير صالحة' })
  deliveryStatus?: DeliveryStatus;
}

export class ReplaceOrderItemsDto {
  @ApiProperty({ type: [OrderItemInputDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'الطلب يجب أن يحتوي منتجاً واحداً على الأقل' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items!: OrderItemInputDto[];
}

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatus })
  @IsEnum(OrderStatus, { message: 'حالة الطلب غير صالحة' })
  status!: OrderStatus;

  @ApiPropertyOptional({ description: 'ملاحظة تُحفظ في سجل الحالات' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(trim)
  note?: string;

  @ApiPropertyOptional({ description: 'مطلوب عند الإلغاء' })
  @ValidateIf((dto: UpdateOrderStatusDto) => dto.status === OrderStatus.CANCELLED)
  @IsString({ message: 'اكتب سبب الإلغاء' })
  @Length(2, 500, { message: 'اكتب سبب الإلغاء' })
  @Transform(trim)
  cancelReason?: string;
}

export class UpdateOrderPaymentDto {
  @ApiProperty({ description: 'إجمالي المبلغ المستلم حتى الآن (وليس دفعة إضافية)', example: 30000 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(MAX_MONEY)
  paidAmount!: number;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod, { message: 'طريقة الدفع غير صالحة' })
  paymentMethod?: PaymentMethod;
}

export const ORDER_SORT_FIELDS = ['createdAt', 'orderNumber', 'total'] as const;

export class QueryOrdersDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional({ description: 'الطلبات المفتوحة فقط (لم تُسلَّم ولم تُلغَ)' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  open?: boolean;

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @ApiPropertyOptional({ enum: DeliveryStatus })
  @IsOptional()
  @IsEnum(DeliveryStatus)
  deliveryStatus?: DeliveryStatus;

  @ApiPropertyOptional({ enum: OrderSource })
  @IsOptional()
  @IsEnum(OrderSource)
  source?: OrderSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 40)
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 40)
  conversationId?: string;

  @ApiPropertyOptional({ example: '2026-01-01T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.000Z' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ enum: ORDER_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(ORDER_SORT_FIELDS)
  sortBy: (typeof ORDER_SORT_FIELDS)[number] = 'createdAt';
}
