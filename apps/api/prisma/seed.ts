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

async function main(): Promise<void> {
  const referenceOnly = process.argv.includes('--reference-only');

  console.log('Seeding AI Commerce Platform…');
  await seedPermissions();
  await seedPlans();
  await seedPlatformAdmin();

  if (!referenceOnly) {
    await seedDemoCompany();
  }

  console.log('Done.');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
