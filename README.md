# AI Commerce Platform

منصة SaaS لإدارة المبيعات القادمة من **واتساب وإنستغرام وفيسبوك ماسنجر**، مع مساعد ذكي
يرد على الزبائن، يبحث في المنتجات والأسعار والمخزون، يجمع بيانات الطلب، ويحوّل المحادثة
إلى **طلب** داخل النظام.

```
Customer → WhatsApp / Instagram / Facebook → AI Sales Agent
        → Products / Inventory → Order → Customer Management → Reports
```

المنصة موجّهة للسوق العراقي والعربي: الواجهة **عربية RTL** بشكل افتراضي، والعملة
الافتراضية **الدينار العراقي (د.ع)**.

---

## الحالة الحالية

| المرحلة | النطاق | الحالة |
| --- | --- | --- |
| 1 | البنية، قاعدة البيانات، المصادقة، الشركات، المستخدمون، الأدوار والصلاحيات، سجل العمليات | ✅ مكتملة |
| 2 | المنتجات، التصنيفات، المتغيرات، المخزون | ⏳ التالية |
| 3 | الزبائن، المحادثات، الرسائل | ⏳ |
| 4 | الطلبات ودورة حياتها | ⏳ |
| 5 | قنوات واتساب وإنستغرام وفيسبوك والـ Webhooks | ⏳ |
| 6 | خدمة الذكاء الاصطناعي وأدواته والتحويل لموظف بشري | ⏳ |
| 7 | لوحة التحكم، التقارير، الإشعارات | ⏳ |
| 8 | الاستخدام، الاشتراكات، الباقات، الحدود | ⏳ |
| 9 | الاختبارات، الأمان، الأداء، التهيئة للإنتاج | ⏳ |
| 10 | Docker، CI/CD، النشر، المراقبة، النسخ الاحتياطي | 🟡 الأساس جاهز |

مخطط قاعدة البيانات مكتمل لكل المراحل منذ المرحلة الأولى، فالمراحل القادمة تضيف
سلوكاً ولا تعيد تشكيل قاعدة البيانات.

---

## التقنيات

| الطبقة | التقنية |
| --- | --- |
| Backend | NestJS 10، TypeScript، Prisma 6، PostgreSQL 16، Redis 7 |
| Frontend | Vue 3 (Composition API)، TypeScript، Pinia، Vue Router، Vuetify 3، Axios |
| الاختبارات | Jest (وحدة + E2E)، Supertest، Vitest |
| التشغيل | Docker، docker compose، nginx، GitHub Actions |

---

## التشغيل السريع عبر Docker

```bash
cp .env.example .env

# أنشئ الأسرار المطلوبة (لن تعمل الخدمة بقيم افتراضية ضعيفة)
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET
openssl rand -base64 32   # ENCRYPTION_KEY

docker compose up -d
docker compose run --rm migrate     # تطبيق المايكريشن وبيانات النظام الأساسية
```

| الخدمة | العنوان |
| --- | --- |
| الواجهة | http://localhost:8080 |
| الـAPI | http://localhost:3000/api/v1 |
| توثيق Swagger | http://localhost:3000/api/v1/docs |
| فحص الجاهزية | http://localhost:3000/health |

---

## التشغيل للتطوير

يتطلب: Node.js 22، PostgreSQL 16، Redis 7.

```bash
npm install

# 1) الـAPI
cd apps/api
cp .env.example .env                 # عدّل DATABASE_URL والأسرار
npm run db:migrate
npm run db:seed                      # بيانات تجريبية كاملة
npm run start:dev                    # http://localhost:3000

# 2) الواجهة (في نافذة أخرى)
cd apps/web
cp .env.example .env
npm run dev                          # http://localhost:5173
```

أو من جذر المشروع: `npm run dev` لتشغيل الاثنين معاً.

### حسابات البيانات التجريبية

| الحساب | البريد | كلمة المرور | الدور |
| --- | --- | --- | --- |
| مالك المتجر | `owner@demo-store.iq` | `Demo@12345` | مالك الشركة |
| مدير | `manager@demo-store.iq` | `Demo@12345` | مدير |
| مندوب | `agent@demo-store.iq` | `Demo@12345` | مندوب مبيعات |
| مدير المنصة | `admin@ai-commerce.iq` | `Admin@12345` | مدير المنصة |

> غيّر كلمات المرور هذه قبل أي نشر حقيقي.

---

## الأوامر

| الأمر | الوظيفة |
| --- | --- |
| `npm run dev` | تشغيل الـAPI والواجهة معاً |
| `npm run build` | بناء المشروعين |
| `npm run lint` | فحص الكود في المشروعين |
| `npm run typecheck` | فحص الأنواع |
| `npm test` | اختبارات الوحدة للـAPI |
| `npm run test:e2e` | اختبارات E2E (المصادقة، الصلاحيات، عزل الشركات) |
| `npm run db:migrate` | تطبيق المايكريشن |
| `npm run db:seed` | البيانات التجريبية |

---

## بنية المشروع

```
.
├── apps/
│   ├── api/                  NestJS API
│   │   ├── prisma/           المخطط، المايكريشن، البذور
│   │   ├── src/common/       البنية المشتركة (السياق، Prisma، الحراس، الأخطاء)
│   │   ├── src/modules/      وحدات الأعمال
│   │   └── test/             اختبارات E2E
│   └── web/                  لوحة تحكم Vue 3
│       └── src/{components,composables,layouts,router,services,stores,types,views}
├── docs/                     ARCHITECTURE.md · API.md · DEPLOYMENT.md
├── docker-compose.yml
└── .github/workflows/ci.yml
```

---

## التوثيق

| الملف | المحتوى |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | المعمارية، نموذج البيانات، استراتيجية تعدد الشركات، معمارية الذكاء الاصطناعي، الأمان |
| [docs/API.md](docs/API.md) | عقد الـAPI، شكل الاستجابة، رموز الأخطاء، نقاط النهاية |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | النشر، المتغيرات، المايكريشن، النسخ الاحتياطي، المراقبة |

## الترخيص

مشروع خاص. جميع الحقوق محفوظة.
