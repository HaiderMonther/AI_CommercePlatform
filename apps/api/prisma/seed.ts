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
import { config as loadEnv } from 'dotenv';
import { expand } from 'dotenv-expand';
import {
  ALL_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  permissionGroupOf,
} from '../src/common/constants/permissions.constant';
import { SUPER_ADMIN_ROLE, SYSTEM_ROLE, SYSTEM_ROLES } from '../src/common/constants/roles.constant';

// Same .env as the API (which composes DATABASE_URL from DB_*); variables already set in
// the environment, as in CI and Docker, take precedence.
expand(loadEnv());

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

type Channel = 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK';

interface DemoCustomer {
  name: string;
  phone?: string;
  city?: string;
  tags?: string[];
  notes?: string;
  status?: 'ACTIVE' | 'BLOCKED';
  identities: { channel: Channel; platformUserId: string; displayName?: string }[];
}

interface DemoConversation {
  customer: number;
  channel: Channel;
  status: 'OPEN' | 'PENDING' | 'RESOLVED' | 'CLOSED';
  mode: 'AI' | 'HUMAN';
  assignToAgent?: boolean;
  handoverReason?: string;
  /** [sender, text, minutes ago] */
  messages: ['CUSTOMER' | 'AI' | 'AGENT', string, number][];
}

const DEMO_CUSTOMERS: DemoCustomer[] = [
  {
    name: 'علي حسين',
    phone: '+9647701234567',
    city: 'بغداد',
    tags: ['زبون دائم'],
    identities: [{ channel: 'WHATSAPP', platformUserId: '9647701234567', displayName: 'Ali' }],
  },
  {
    name: 'زينب كريم',
    phone: '+9647812345678',
    city: 'البصرة',
    identities: [
      { channel: 'WHATSAPP', platformUserId: '9647812345678' },
      { channel: 'INSTAGRAM', platformUserId: 'ig-17841400000001', displayName: 'zainab.k' },
    ],
  },
  {
    name: 'مصطفى جاسم',
    city: 'الموصل',
    identities: [
      { channel: 'INSTAGRAM', platformUserId: 'ig-17841400000002', displayName: 'mustafa.j' },
    ],
  },
  {
    name: 'نور الهدى',
    phone: '+9647509876543',
    city: 'أربيل',
    identities: [{ channel: 'FACEBOOK', platformUserId: 'fb-6100000000001', displayName: 'Noor Alhuda' }],
  },
  {
    name: 'سجى محمد',
    phone: '+9647823334455',
    city: 'بغداد',
    identities: [{ channel: 'WHATSAPP', platformUserId: '9647823334455' }],
  },
  {
    name: 'ياسر فاضل',
    phone: '+9647734445566',
    city: 'كربلاء',
    tags: ['جملة'],
    notes: 'يطلب بالجملة للمحل، يفضّل الاتصال مساءً.',
    identities: [],
  },
  {
    name: 'حسن عباس',
    phone: '+9647712223344',
    city: 'النجف',
    status: 'BLOCKED',
    notes: 'رسائل مزعجة متكررة.',
    identities: [{ channel: 'WHATSAPP', platformUserId: '9647712223344' }],
  },
];

const DEMO_CONVERSATIONS: DemoConversation[] = [
  {
    customer: 0,
    channel: 'WHATSAPP',
    status: 'OPEN',
    mode: 'AI',
    messages: [
      ['CUSTOMER', 'السلام عليكم، القميص القطني الأبيض متوفر مقاس L؟', 45],
      ['AI', 'وعليكم السلام هلا بيك 🌷 نعم متوفر مقاس L بسعر 25,000 د.ع. تحب أحجزه إلك؟', 44],
      ['CUSTOMER', 'شكد التوصيل لبغداد؟', 3],
    ],
  },
  {
    customer: 1,
    channel: 'INSTAGRAM',
    status: 'OPEN',
    mode: 'HUMAN',
    assignToAgent: true,
    handoverReason: 'الزبون طلب التحدث مع موظف',
    messages: [
      ['CUSTOMER', 'مرحبا، اريد استبدل فستان اشتريته الأسبوع الماضي', 120],
      ['AI', 'أهلاً زينب، الاستبدال متاح خلال 3 أيام من الاستلام مع الفاتورة. شنو سبب الاستبدال؟', 119],
      ['CUSTOMER', 'اريد احجي ويه موظف رجاءً', 20],
      ['CUSTOMER', 'موجودين؟', 18],
    ],
  },
  {
    customer: 3,
    channel: 'FACEBOOK',
    status: 'PENDING',
    mode: 'HUMAN',
    assignToAgent: true,
    handoverReason: 'رد موظف على المحادثة',
    messages: [
      ['CUSTOMER', 'هل يوجد توصيل إلى أربيل؟', 600],
      ['AGENT', 'نعم، التوصيل لأربيل خلال 2-4 أيام بكلفة 5,000 د.ع', 590],
      ['CUSTOMER', 'تمام، راح أرسل العنوان بعدين', 585],
    ],
  },
  {
    customer: 4,
    channel: 'WHATSAPP',
    status: 'RESOLVED',
    mode: 'AI',
    messages: [
      ['CUSTOMER', 'وصل الطلب، شكراً جزيلاً', 1500],
      ['AI', 'العفو، نتمنى يعجبك! ننتظر طلبك الجاي 🌸', 1499],
    ],
  },
  {
    customer: 2,
    channel: 'INSTAGRAM',
    status: 'OPEN',
    mode: 'AI',
    messages: [['CUSTOMER', 'عندكم أحذية رياضية؟', 8]],
  },
  {
    customer: 6,
    channel: 'WHATSAPP',
    status: 'CLOSED',
    mode: 'HUMAN',
    handoverReason: 'تحويل يدوي من لوحة التحكم',
    messages: [['CUSTOMER', 'رسالة ترويجية مكررة', 3000]],
  },
];

async function seedCrm(companyId: string, agentId: string | null): Promise<void> {
  const existing = await prisma.customer.count({ where: { companyId } });
  if (existing > 0) {
    console.log('• customers already present');
    return;
  }

  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
  const customerIds: string[] = [];

  for (const [index, definition] of DEMO_CUSTOMERS.entries()) {
    const customer = await prisma.customer.create({
      data: {
        companyId,
        name: definition.name,
        phone: definition.phone ?? null,
        city: definition.city ?? null,
        tags: definition.tags ?? [],
        notes: definition.notes ?? null,
        status: definition.status ?? 'ACTIVE',
        createdAt: minutesAgo(5000 - index * 100),
        identities: {
          create: definition.identities.map((identity) => ({ companyId, ...identity })),
        },
      },
    });
    customerIds.push(customer.id);
  }

  for (const definition of DEMO_CONVERSATIONS) {
    const customerId = customerIds[definition.customer];
    const first = definition.messages[0];
    const last = definition.messages[definition.messages.length - 1];
    const lastInbound = [...definition.messages].reverse().find(([sender]) => sender === 'CUSTOMER');

    // Unread = the customer's trailing messages that nobody has answered yet.
    const lastReplyIndex = definition.messages.findLastIndex(([sender]) => sender !== 'CUSTOMER');
    const unreadCount =
      definition.status === 'OPEN' ? definition.messages.length - 1 - lastReplyIndex : 0;

    const done = definition.status === 'RESOLVED' || definition.status === 'CLOSED';

    await prisma.conversation.create({
      data: {
        companyId,
        customerId,
        channel: definition.channel,
        status: definition.status,
        mode: definition.mode,
        assignedUserId: definition.assignToAgent ? agentId : null,
        handoverReason: definition.mode === 'HUMAN' ? (definition.handoverReason ?? null) : null,
        handoverAt: definition.mode === 'HUMAN' ? minutesAgo(first[2] - 1) : null,
        unreadCount,
        lastMessageAt: minutesAgo(last[2]),
        closedAt: done ? minutesAgo(last[2] - 1) : null,
        createdAt: minutesAgo(first[2]),
        messages: {
          create: definition.messages.map(([sender, content, ago]) => ({
            companyId,
            senderType: sender,
            senderUserId: sender === 'AGENT' ? agentId : null,
            direction: sender === 'CUSTOMER' ? 'INBOUND' : 'OUTBOUND',
            content,
            deliveryStatus: sender === 'CUSTOMER' ? 'DELIVERED' : 'READ',
            createdAt: minutesAgo(ago),
          })),
        },
      },
    });

    if (lastInbound) {
      await prisma.customer.update({
        where: { id: customerId },
        data: { lastContactAt: minutesAgo(lastInbound[2]) },
      });
    }
  }

  console.log(
    `✓ crm: ${DEMO_CUSTOMERS.length} customers, ${DEMO_CONVERSATIONS.length} conversations`,
  );
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

      const agent = await prisma.user.findFirst({
        where: { companyId: demo.id, email: DEMO.agent.email },
        select: { id: true },
      });
      await seedCrm(demo.id, agent?.id ?? null);
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
