/**
 * Development seed.
 *
 * Idempotent: safe to run repeatedly. It always syncs the permission catalog and the
 * plan definitions (both are reference data the application depends on), and only
 * creates the demo tenant when it is absent.
 *
 * Reference data only:   npm run db:seed -- --reference-only
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import {
  ALL_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  permissionGroupOf,
} from '../src/common/constants/permissions.constant';
import { SUPER_ADMIN_ROLE, SYSTEM_ROLE, SYSTEM_ROLES } from '../src/common/constants/roles.constant';

const prisma = new PrismaClient();

const DEMO = {
  companyName: 'متجر بغداد للأزياء',
  slug: 'baghdad-fashion',
  owner: { email: 'owner@demo-store.iq', password: 'Demo@12345', fullName: 'حيدر منذر' },
  manager: { email: 'manager@demo-store.iq', password: 'Demo@12345', fullName: 'سارة علي' },
  agent: { email: 'agent@demo-store.iq', password: 'Demo@12345', fullName: 'مصطفى كريم' },
};

const PLATFORM_ADMIN = {
  email: process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@ai-commerce.iq',
  password: process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'Admin@12345',
  fullName: 'مدير المنصة',
};

const hash = (password: string) =>
  argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });

async function seedPermissions(): Promise<void> {
  for (const key of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      update: { group: permissionGroupOf(key), description: PERMISSION_DESCRIPTIONS[key] },
      create: { key, group: permissionGroupOf(key), description: PERMISSION_DESCRIPTIONS[key] },
    });
  }

  // Remove permissions that were dropped from the catalog so roles cannot reference them.
  await prisma.permission.deleteMany({ where: { key: { notIn: [...ALL_PERMISSIONS] } } });

  console.log(`✓ ${ALL_PERMISSIONS.length} permissions synced`);
}

async function seedPlans(): Promise<void> {
  const plans: Prisma.PlanCreateInput[] = [
    {
      tier: 'BASIC',
      name: 'Basic',
      nameAr: 'الأساسية',
      priceMonthly: new Prisma.Decimal(29),
      limits: { AI_MESSAGES: 1000, USERS: 3, PRODUCTS: 300, CHANNELS: 1 },
      features: ['قناة واحدة', 'ردود ذكية', 'إدارة المنتجات والطلبات'],
    },
    {
      tier: 'BUSINESS',
      name: 'Business',
      nameAr: 'الأعمال',
      priceMonthly: new Prisma.Decimal(79),
      limits: { AI_MESSAGES: 10000, USERS: 10, PRODUCTS: 5000, CHANNELS: 3 },
      features: ['ثلاث قنوات', 'تقارير متقدمة', 'أدوار وصلاحيات مخصصة'],
    },
    {
      tier: 'ENTERPRISE',
      name: 'Enterprise',
      nameAr: 'المؤسسات',
      priceMonthly: new Prisma.Decimal(199),
      limits: { AI_MESSAGES: -1, USERS: -1, PRODUCTS: -1, CHANNELS: -1 },
      features: ['بلا حدود', 'دعم مخصص', 'تكاملات خاصة'],
    },
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({ where: { tier: plan.tier }, update: plan, create: plan });
  }

  console.log(`✓ ${plans.length} plans synced`);
}

async function attachPermissions(roleId: string, keys: readonly string[]): Promise<void> {
  const permissions = await prisma.permission.findMany({
    where: { key: { in: [...keys] } },
    select: { id: true },
  });

  await prisma.rolePermission.createMany({
    data: permissions.map((permission) => ({ roleId, permissionId: permission.id })),
    skipDuplicates: true,
  });
}

async function seedPlatformAdmin(): Promise<void> {
  const existingRole = await prisma.role.findFirst({
    where: { companyId: null, key: SUPER_ADMIN_ROLE.key },
  });

  const role =
    existingRole ??
    (await prisma.role.create({
      data: {
        companyId: null,
        key: SUPER_ADMIN_ROLE.key,
        name: SUPER_ADMIN_ROLE.name,
        nameAr: SUPER_ADMIN_ROLE.nameAr,
        description: SUPER_ADMIN_ROLE.description,
        isSystem: true,
      },
    }));

  await attachPermissions(role.id, SUPER_ADMIN_ROLE.permissions);

  const existing = await prisma.user.findFirst({ where: { email: PLATFORM_ADMIN.email } });
  if (existing) {
    console.log('• platform admin already present');
    return;
  }

  await prisma.user.create({
    data: {
      companyId: null,
      email: PLATFORM_ADMIN.email,
      fullName: PLATFORM_ADMIN.fullName,
      passwordHash: await hash(PLATFORM_ADMIN.password),
      isPlatformAdmin: true,
      roleId: role.id,
    },
  });

  console.log(`✓ platform admin: ${PLATFORM_ADMIN.email}`);
}

async function seedDemoCompany(): Promise<void> {
  const existing = await prisma.company.findUnique({ where: { slug: DEMO.slug } });
  if (existing) {
    console.log('• demo company already present');
    return;
  }

  const basicPlan = await prisma.plan.findUnique({ where: { tier: 'BASIC' } });

  const company = await prisma.company.create({
    data: {
      name: DEMO.companyName,
      slug: DEMO.slug,
      phone: '+9647701234567',
      email: DEMO.owner.email,
      address: 'شارع الرشيد، بغداد',
      city: 'بغداد',
      status: 'ACTIVE',
      planTier: 'BUSINESS',
    },
  });

  const roleIdByKey = new Map<string, string>();
  for (const definition of SYSTEM_ROLES) {
    const role = await prisma.role.create({
      data: {
        companyId: company.id,
        key: definition.key,
        name: definition.name,
        nameAr: definition.nameAr,
        description: definition.description,
        isSystem: true,
      },
    });
    await attachPermissions(role.id, definition.permissions);
    roleIdByKey.set(definition.key, role.id);
  }

  await prisma.aiConfig.create({
    data: {
      companyId: company.id,
      businessName: DEMO.companyName,
      businessDescription: 'متجر ملابس رجالية ونسائية في بغداد، توصيل لجميع المحافظات.',
      tone: 'friendly',
      language: 'ar-IQ',
      currency: 'IQD',
      deliveryPolicy: 'التوصيل خلال 24-48 ساعة داخل بغداد، 2-4 أيام للمحافظات.',
      returnPolicy: 'الاستبدال خلال 3 أيام مع الفاتورة وبشرط عدم الاستعمال.',
      paymentMethods: ['CASH_ON_DELIVERY', 'ZAIN_CASH'],
      handoverKeywords: ['موظف', 'شكوى', 'مدير'],
    },
  });

  if (basicPlan) {
    const start = new Date();
    await prisma.subscription.create({
      data: {
        companyId: company.id,
        planId: basicPlan.id,
        status: 'ACTIVE',
        currentPeriodStart: start,
        currentPeriodEnd: new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  }

  const people = [
    { ...DEMO.owner, roleKey: SYSTEM_ROLE.COMPANY_OWNER },
    { ...DEMO.manager, roleKey: SYSTEM_ROLE.MANAGER },
    { ...DEMO.agent, roleKey: SYSTEM_ROLE.SALES_AGENT },
  ];

  for (const person of people) {
    await prisma.user.create({
      data: {
        companyId: company.id,
        email: person.email,
        fullName: person.fullName,
        passwordHash: await hash(person.password),
        roleId: roleIdByKey.get(person.roleKey) ?? null,
        status: 'ACTIVE',
      },
    });
  }

  console.log(`✓ demo company "${DEMO.companyName}" with ${people.length} users`);
  console.log(`  login: ${DEMO.owner.email} / ${DEMO.owner.password}`);
}

const CATEGORIES = [
  { name: 'ملابس رجالية', children: ['قمصان', 'بناطيل'] },
  { name: 'ملابس نسائية', children: ['فساتين', 'عبايات'] },
  { name: 'أحذية', children: [] },
  { name: 'حقائب', children: [] },
  { name: 'إكسسوارات', children: [] },
];

const PRODUCT_NAMES = [
  'قميص قطني كلاسيك', 'قميص كتان صيفي', 'قميص رسمي أبيض', 'تيشيرت قطن',
  'بنطلون جينز', 'بنطلون قماش رسمي', 'شورت رياضي', 'بدلة رسمية',
  'فستان سهرة', 'فستان صيفي', 'عباية سوداء مطرزة', 'عباية يومية',
  'حذاء رياضي', 'حذاء رسمي جلد', 'صندل صيفي', 'بوت شتوي',
  'حقيبة يد نسائية', 'حقيبة ظهر', 'حقيبة سفر', 'محفظة جلد',
  'حزام جلد', 'نظارة شمسية', 'ساعة يد', 'وشاح صوف',
  'قبعة صيفية', 'جوارب قطن', 'ربطة عنق', 'قفازات جلد',
  'معطف شتوي', 'جاكيت جينز',
];

/**
 * Which category each product belongs in, as an index into the flattened category list
 * [رجالية, قمصان, بناطيل, نسائية, فساتين, عبايات, أحذية, حقائب, إكسسوارات].
 * Mapped by hand so the demo catalog reads like a real store rather than random pairings.
 */
const PRODUCT_CATEGORY_INDEX = [
  1, 1, 1, 1, // قمصان وتيشيرت
  2, 2, 2, 2, // بناطيل وشورت وبدلة
  4, 4, // فساتين
  5, 5, // عبايات
  6, 6, 6, 6, // أحذية
  7, 7, 7, 7, // حقائب ومحفظة
  8, 8, 8, 8, 8, 8, 8, 8, // إكسسوارات
  0, 0, // معاطف ضمن الملابس الرجالية
];

const COLORS = ['أسود', 'أبيض', 'أزرق', 'رمادي'];
const SIZES = ['S', 'M', 'L', 'XL'];

function skuFrom(index: number): string {
  return `PRD-${String(index + 1).padStart(4, '0')}`;
}

async function seedCatalog(companyId: string, userId: string | null): Promise<void> {
  const existing = await prisma.product.count({ where: { companyId } });
  if (existing > 0) {
    console.log('• catalog already present');
    return;
  }

  const categoryIds: string[] = [];

  for (const [index, definition] of CATEGORIES.entries()) {
    const parent = await prisma.category.create({
      data: {
        companyId,
        name: definition.name,
        slug: `cat-${index + 1}`,
        sortOrder: index,
      },
    });
    categoryIds.push(parent.id);

    for (const [childIndex, childName] of definition.children.entries()) {
      const child = await prisma.category.create({
        data: {
          companyId,
          name: childName,
          slug: `cat-${index + 1}-${childIndex + 1}`,
          parentId: parent.id,
          sortOrder: childIndex,
        },
      });
      categoryIds.push(child.id);
    }
  }

  for (const [index, name] of PRODUCT_NAMES.entries()) {
    const price = 15000 + ((index * 7919) % 20) * 2500;
    const cost = Math.round(price * 0.65);
    // Every fifth product carries colour/size variants, so the demo covers both shapes.
    const withVariants = index % 5 === 0;
    const stock = withVariants ? 0 : 3 + ((index * 31) % 40);

    const product = await prisma.product.create({
      data: {
        companyId,
        categoryId: categoryIds[PRODUCT_CATEGORY_INDEX[index] ?? 0],
        name,
        sku: skuFrom(index),
        description: `${name} بخامة عالية الجودة، متوفر بعدة ألوان ومقاسات. التوصيل لجميع المحافظات.`,
        price: new Prisma.Decimal(price),
        salePrice: index % 4 === 0 ? new Prisma.Decimal(Math.round(price * 0.85)) : null,
        costPrice: new Prisma.Decimal(cost),
        stock,
        lowStockThreshold: 5,
        hasVariants: withVariants,
        tags: index % 3 === 0 ? ['الأكثر مبيعاً'] : [],
        isActive: index % 11 !== 0,
        images: {
          create: [
            { url: `https://picsum.photos/seed/product-${index + 1}/600/600`, isPrimary: true, sortOrder: 0 },
          ],
        },
      },
    });

    if (stock > 0) {
      await prisma.inventoryMovement.create({
        data: {
          companyId,
          productId: product.id,
          type: 'STOCK_IN',
          quantity: stock,
          quantityBefore: 0,
          quantityAfter: stock,
          unitCost: new Prisma.Decimal(cost),
          reason: 'رصيد افتتاحي',
          referenceType: 'Import',
          userId,
        },
      });
    }

    if (!withVariants) {
      continue;
    }

    let productStock = 0;

    for (const [variantIndex, color] of COLORS.slice(0, 2).entries()) {
      for (const [sizeIndex, size] of SIZES.slice(0, 2).entries()) {
        const variantStock = 2 + ((index + variantIndex + sizeIndex) * 13) % 25;
        productStock += variantStock;

        const variant = await prisma.productVariant.create({
          data: {
            companyId,
            productId: product.id,
            sku: `${skuFrom(index)}-${color.slice(0, 3)}-${size}`,
            name: `${color} / ${size}`,
            attributes: { color, size },
            costPrice: new Prisma.Decimal(cost),
            stock: variantStock,
          },
        });

        await prisma.inventoryMovement.create({
          data: {
            companyId,
            productId: product.id,
            variantId: variant.id,
            type: 'STOCK_IN',
            quantity: variantStock,
            quantityBefore: 0,
            quantityAfter: variantStock,
            unitCost: new Prisma.Decimal(cost),
            reason: 'رصيد افتتاحي',
            referenceType: 'Import',
            userId,
          },
        });
      }
    }

    await prisma.product.update({
      where: { id: product.id },
      data: { stock: productStock },
    });
  }

  const [categories, products, variants] = await Promise.all([
    prisma.category.count({ where: { companyId } }),
    prisma.product.count({ where: { companyId } }),
    prisma.productVariant.count({ where: { companyId } }),
  ]);

  console.log(`✓ catalog: ${categories} categories, ${products} products, ${variants} variants`);
}

async function main(): Promise<void> {
  const referenceOnly = process.argv.includes('--reference-only');

  console.log('Seeding AI Commerce Platform…');
  await seedPermissions();
  await seedPlans();
  await seedPlatformAdmin();

  if (!referenceOnly) {
    await seedDemoCompany();

    const demo = await prisma.company.findUnique({ where: { slug: DEMO.slug } });
    if (demo) {
      const owner = await prisma.user.findFirst({
        where: { companyId: demo.id, email: DEMO.owner.email },
        select: { id: true },
      });
      await seedCatalog(demo.id, owner?.id ?? null);
    }
  }

  console.log('Done.');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
