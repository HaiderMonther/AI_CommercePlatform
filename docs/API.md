# API — AI Commerce Platform

**Base URL:** `/api/v1` · **التوثيق التفاعلي:** `/api/v1/docs` (Swagger)

---

## 1. شكل الاستجابة

كل استجابة — نجاحاً أو فشلاً — تتبع غلافاً واحداً، فلا يحتاج العميل إلى تخمين البنية.

**نجاح**

```json
{
  "success": true,
  "message": "تم إنشاء الطلب بنجاح",
  "data": { },
  "correlationId": "9f1c2e4a-..."
}
```

**فشل**

```json
{
  "success": false,
  "message": "البيانات المرسلة غير صالحة",
  "code": "VALIDATION_FAILED",
  "data": null,
  "details": ["البريد الإلكتروني غير صالح"],
  "correlationId": "9f1c2e4a-..."
}
```

`code` ثابت ومخصص للبرمجة، و`message` للعرض على المستخدم بالعربية.
`correlationId` يظهر في سجلات الـAPI أيضاً، وهو ما يُطلب من المستخدم عند الدعم.

**القوائم المقسّمة**

```json
{
  "success": true,
  "message": "تم جلب المستخدمين",
  "data": {
    "items": [],
    "meta": { "total": 42, "page": 1, "limit": 20, "totalPages": 3, "hasNext": true, "hasPrev": false }
  }
}
```

معاملات مشتركة لكل القوائم: `page` (افتراضي 1)، `limit` (افتراضي 20، أقصى 100)،
`search`، `sortOrder` (`asc` \| `desc`).

---

## 2. رموز الأخطاء

| الرمز | HTTP | المعنى |
| --- | --- | --- |
| `VALIDATION_FAILED` | 400 | بيانات غير صالحة أو حقل غير معروف في الجسم |
| `INVALID_CREDENTIALS` | 401 | بريد أو كلمة مرور خاطئة (نفس الرسالة للحالتين) |
| `UNAUTHENTICATED` | 401 | لا يوجد رمز دخول أو الرمز غير صالح |
| `TOKEN_EXPIRED` | 401 | انتهت صلاحية رمز الدخول — استخدم `/auth/refresh` |
| `TOKEN_INVALID` | 401 | رمز تالف أو من نوع خاطئ |
| `REFRESH_TOKEN_REUSED` | 401 | إعادة استخدام رمز مستهلك — أُلغيت عائلة الجلسة كاملة |
| `ACCOUNT_SUSPENDED` | 401 | الحساب موقوف |
| `COMPANY_SUSPENDED` | 401 | اشتراك الشركة موقوف |
| `EMAIL_ALREADY_USED` | 409 | البريد مستخدم مسبقاً |
| `FORBIDDEN` | 403 | ممنوع |
| `PERMISSION_DENIED` | 403 | ينقص المستخدم صلاحية مطلوبة |
| `CROSS_TENANT_ACCESS` | 403 | محاولة وصول إلى بيانات شركة أخرى |
| `NOT_FOUND` | 404 | العنصر غير موجود — وكذلك عناصر الشركات الأخرى |
| `ROLE_NOT_FOUND` | 400 | الدور غير موجود ضمن الشركة |
| `SYSTEM_ROLE_IMMUTABLE` | 400 | الأدوار الافتراضية غير قابلة للتعديل |
| `ROLE_IN_USE` | 409 | الدور مرتبط بمستخدمين |
| `LAST_OWNER_PROTECTED` | 400 | يجب بقاء مالك فعّال واحد على الأقل |
| `CUSTOMER_NOT_FOUND` | 404 | الزبون غير موجود |
| `CUSTOMER_PHONE_TAKEN` | 409 | رقم الهاتف مسجّل لزبون آخر (`details.customerId`) |
| `CUSTOMER_BLOCKED` | 400 | لا يمكن الرد على زبون محظور أو بدء محادثة معه |
| `CONVERSATION_NOT_FOUND` | 404 | المحادثة غير موجودة |
| `ASSIGNEE_INVALID` | 400 | الموظف غير فعّال، أو من شركة أخرى، أو لا يملك `conversations.reply` |
| `CONFLICT` | 409 | تعارض في قيمة فريدة |
| `RATE_LIMITED` | 429 | تجاوز حد الطلبات |
| `INTERNAL_ERROR` | 500 | خطأ غير متوقع |

> **ملاحظة أمنية:** قراءة سجل يعود لشركة أخرى تُرجع `404 NOT_FOUND` لا `403`،
> لأن `403` تؤكد وجود السجل وتحوّل المعرفات إلى أداة استكشاف.

---

## 3. المصادقة

كل النقاط تتطلب `Authorization: Bearer <accessToken>` ما لم تُعلَّم بـ 🔓.

### التسجيل وتسجيل الدخول

```
🔓 POST /auth/register       إنشاء شركة + حساب المالك
🔓 POST /auth/login          تسجيل الدخول
🔓 POST /auth/refresh        تجديد الجلسة (يدوّر رمز التحديث)
   POST /auth/logout         إنهاء الجلسة الحالية
   GET  /auth/me             بيانات المستخدم الحالي وصلاحياته
   POST /auth/change-password  تغيير كلمة المرور وإنهاء كل الجلسات
```

**`POST /auth/register`**

```json
{
  "companyName": "متجر بغداد للأزياء",
  "fullName": "حيدر منذر",
  "email": "owner@demo-store.iq",
  "password": "Demo@12345",
  "phone": "+9647701234567"
}
```

ينشئ في معاملة واحدة: الشركة، خمسة أدوار نظامية بصلاحياتها، إعدادات ذكاء اصطناعي
افتراضية بالعربية العراقية، اشتراك تجريبي 14 يوماً، وحساب المالك.

**الاستجابة (لـ register / login / refresh)**

```json
{
  "user": {
    "id": "c...", "email": "owner@demo-store.iq", "fullName": "حيدر منذر",
    "companyId": "c...", "isPlatformAdmin": false,
    "roleKey": "COMPANY_OWNER", "roleName": "مالك الشركة",
    "permissions": ["company.read", "orders.create", "..."]
  },
  "company": { "id": "c...", "name": "...", "slug": "...", "currency": "IQD", "planTier": "BASIC" },
  "tokens": { "accessToken": "eyJ...", "refreshToken": "eyJ...", "expiresIn": 900 }
}
```

### دورة حياة الرموز

```
تسجيل دخول ──▶ accessToken (15د) + refreshToken (30ي، عائلة جلسة واحدة)
                     │
            انتهى؟ ──▶ POST /auth/refresh  ──▶ رمزان جديدان، القديم يُبطَل
                     │
   تقديم رمز مستهلَك ──▶ 401 REFRESH_TOKEN_REUSED + إلغاء العائلة كاملة
```

قواعد كلمة المرور: 8 أحرف على الأقل، حرف كبير وحرف صغير ورقم.
حد الطلبات على نقاط المصادقة: 10 محاولات/دقيقة لكل IP.

---

## 4. النقاط المتاحة

### الشركة

| الطريقة | المسار | الصلاحية |
| --- | --- | --- |
| `GET` | `/company` | `company.read` |
| `PATCH` | `/company` | `company.update` |
| `GET` | `/company/stats` | `company.read` |

الحقول القابلة للتعديل: `name`، `phone`، `email`، `address`، `city`، `logoUrl`،
`currency`، `timezone`، `locale`. الـ`slug` و`status` و`planTier` غير قابلة للتعديل
من هنا. أي حقل خارج القائمة يرفض الطلب بـ`VALIDATION_FAILED`.

### المستخدمون

| الطريقة | المسار | الصلاحية |
| --- | --- | --- |
| `GET` | `/users` | `users.read` |
| `GET` | `/users/:id` | `users.read` |
| `POST` | `/users` | `users.create` |
| `PATCH` | `/users/:id` | `users.update` |
| `POST` | `/users/:id/reset-password` | `users.update` |
| `DELETE` | `/users/:id` | `users.delete` |

مرشّحات القائمة: `status` (`ACTIVE` \| `INVITED` \| `SUSPENDED`)، `roleId`، `search`.

البريد غير قابل للتعديل بعد الإنشاء (هوية الدخول ومرجع سجل التدقيق).
تغيير الدور أو الحالة أو إعادة تعيين كلمة المرور تُنهي جلسات المستخدم فوراً.
الحذف ناعم: يُحرَّر البريد بلاحقة ويبقى السجل للتدقيق.

### الأدوار والصلاحيات

| الطريقة | المسار | الصلاحية |
| --- | --- | --- |
| `GET` | `/roles` | `roles.read` |
| `GET` | `/roles/:id` | `roles.read` |
| `POST` | `/roles` | `roles.create` |
| `PATCH` | `/roles/:id` | `roles.update` |
| `DELETE` | `/roles/:id` | `roles.delete` |
| `GET` | `/permissions` | `roles.read` |

`POST /roles`

```json
{
  "name": "Warehouse Keeper",
  "nameAr": "أمين المخزن",
  "description": "إدارة المخزون فقط",
  "permissions": ["products.read", "inventory.read", "inventory.adjust"]
}
```

الأدوار النظامية الخمسة (`COMPANY_OWNER`، `ADMIN`، `MANAGER`، `SALES_AGENT`، `VIEWER`)
للقراءة فقط. تعديل الصلاحيات يُنهي جلسات المستخدمين المرتبطين ليسري التغيير فوراً.

`GET /permissions` يُرجع الكتالوج مجمّعاً لعرض مصفوفة الصلاحيات:

```json
[{ "group": "orders", "groupLabel": "الطلبات",
   "permissions": [{ "key": "orders.read", "description": "عرض الطلبات" }] }]
```

### التصنيفات

| الطريقة | المسار | الصلاحية |
| --- | --- | --- |
| `GET` | `/categories` | `categories.read` |
| `GET` | `/categories/:id` | `categories.read` |
| `POST` | `/categories` | `categories.create` |
| `PATCH` | `/categories/:id` | `categories.update` |
| `DELETE` | `/categories/:id` | `categories.delete` |

`?tree=true` يُرجع الشجرة متداخلة. التصنيف الذي يحتوي منتجات أو فروعاً لا يُحذف،
ولا يمكن جعل تصنيف تابعاً لأحد فروعه، والعمق محدود بأربعة مستويات.

### المنتجات والمتغيرات

| الطريقة | المسار | الصلاحية |
| --- | --- | --- |
| `GET` | `/products` | `products.read` |
| `GET` | `/products/:id` | `products.read` |
| `POST` | `/products` | `products.create` |
| `PATCH` | `/products/:id` | `products.update` |
| `DELETE` | `/products/:id` | `products.delete` |
| `GET` | `/products/:id/variants` | `products.read` |
| `POST` | `/products/:id/variants` | `products.update` |
| `PATCH` | `/products/:id/variants/:variantId` | `products.update` |
| `DELETE` | `/products/:id/variants/:variantId` | `products.delete` |

مرشّحات القائمة: `categoryId`، `isActive`، `lowStock`، `outOfStock`، `search`
(الاسم أو الرمز أو الوصف أو الوسوم)، و`sortBy` من `createdAt|name|price|stock`.

**الكمية غير قابلة للتعديل من نقاط المنتج.** `initialStock` يُقبل عند الإنشاء فقط
ويُسجَّل كحركة إدخال، وأي تغيير لاحق يمر عبر `POST /inventory/adjust`.

رمز المنتج يُولَّد تلقائياً إن لم يُرسل، وهو فريد داخل الشركة فقط — شركتان مختلفتان
قد تستخدمان الرمز نفسه. الحذف ناعم ويحرّر الرمز لإعادة الاستخدام.

أول متغير يحوّل المنتج إلى منتج بمتغيرات: يصبح مخزونه مجموع متغيراته، وتُنقل كميته
السابقة بحركة `STOCK_OUT` مسجّلة بدل أن تختفي. ولا يُسمح بمتغيرين بنفس الخصائص.

### المخزون

| الطريقة | المسار | الصلاحية |
| --- | --- | --- |
| `GET` | `/inventory/movements` | `inventory.read` |
| `POST` | `/inventory/adjust` | `inventory.adjust` |
| `GET` | `/inventory/low-stock` | `inventory.read` |
| `GET` | `/inventory/summary` | `inventory.read` |

`POST /inventory/adjust`

```json
{ "productId": "c...", "variantId": "c...", "type": "STOCK_IN", "quantity": 10, "reason": "شحنة جديدة" }
```

| النوع | الأثر | معنى `quantity` |
| --- | --- | --- |
| `STOCK_IN` | +المخزون | مقدار الزيادة |
| `RETURN` | +المخزون | مقدار الإرجاع |
| `STOCK_OUT` | −المخزون | مقدار النقص |
| `ADJUSTMENT` | ضبط مطلق | **الكمية النهائية** بعد الجرد، لا الفرق |
| `SALE` · `RESERVATION` · `RELEASE` | — | خاصة بدورة الطلبات، مرفوضة يدوياً |

كل حركة تُخزَّن بالقيمة المُوقَّعة مع `quantityBefore` و`quantityAfter`، فمجموع
الحركات يساوي المخزون الحالي دائماً. المخزون لا يصبح سالباً: محاولة تجاوز المتوفر
تُرجع `409 INSUFFICIENT_STOCK`.

### الزبائن

| الطريقة | المسار | الصلاحية |
| --- | --- | --- |
| `GET` | `/customers` | `customers.read` |
| `GET` | `/customers/:id` | `customers.read` |
| `POST` | `/customers` | `customers.create` |
| `PATCH` | `/customers/:id` | `customers.update` |
| `DELETE` | `/customers/:id` | `customers.delete` |

مرشّحات القائمة: `status`، `channel` (زبائن لديهم حساب على القناة)، `city`، `tag`،
`search` (الاسم، البريد، الهاتف)، و`sortBy` من `createdAt|name|lastContactAt|totalSpent|totalOrders`.

**الهاتف يُوحَّد إلى E.164** (`+9647701234567`) سواء كُتب `0770 123 4567` أو
`9647701234567` أو بأرقام عربية `٠٧٧٠…`، وهو فريد داخل الشركة. لذلك البحث بـ`0770123`
يجد الزبون المخزّن بالصيغة الدولية. الرقم المحلي بلا رمز دولة يُقبل بصيغة الموبايل
العراقي فقط.

`GET /customers/:id` يُرجع أيضاً `identities` (حساباته على كل قناة) و`recentConversations`.
`status: BLOCKED` يمنع الرد وبدء محادثات جديدة. الحذف ناعم: تبقى الطلبات والمحادثات،
يُحرَّر الرقم، وتُحذف هويات القنوات حتى لا تُنسب رسالته القادمة لسجل محذوف.

### المحادثات

| الطريقة | المسار | الصلاحية |
| --- | --- | --- |
| `GET` | `/conversations` | `conversations.read` |
| `GET` | `/conversations/stats` | `conversations.read` |
| `GET` | `/conversations/:id` | `conversations.read` |
| `POST` | `/conversations` | `conversations.reply` |
| `PATCH` | `/conversations/:id/assign` | `conversations.assign` |
| `PATCH` | `/conversations/:id/status` | `conversations.close` |
| `PATCH` | `/conversations/:id/mode` | `conversations.reply` |
| `POST` | `/conversations/:id/read` | `conversations.read` |

مرشّحات القائمة: `active=true` (OPEN + PENDING)، `status`، `mode`، `channel`، `customerId`،
`unread=true`، `assignee` (`me` · `unassigned` · معرف مستخدم)، و`search` باسم الزبون أو
هاتفه. الترتيب دائماً بآخر رسالة، وكل عنصر يحمل `lastMessage`.

**دورة الحياة**

```
OPEN ──▶ PENDING ──▶ RESOLVED ──▶ CLOSED
  ▲         │            │
  └─────────┴────────────┘  رسالة جديدة من الزبون تعيدها OPEN
                            (أما CLOSED فنهائية: الرسالة التالية تفتح محادثة جديدة)
```

`PATCH /:id/assign` يقبل `{ "userId": "..." }` أو `{ "userId": null }` صراحةً لإلغاء الإسناد.
`PATCH /:id/mode` بـ`{ "mode": "HUMAN", "reason": "..." }` يوقف الرد الآلي، و`AI` يعيده.
`POST /conversations` (`customerId`، `channel`، `subject`) يفتح محادثة بوضع HUMAN مسندة
لمنشئها، ويُرجع المحادثة النشطة الموجودة إن وُجدت. واتساب يتطلب رقم هاتف، وإنستغرام
وماسنجر يتطلبان أن يكون الزبون راسل المتجر منهما من قبل.

### الرسائل

| الطريقة | المسار | الصلاحية |
| --- | --- | --- |
| `GET` | `/conversations/:id/messages` | `conversations.read` |
| `POST` | `/conversations/:id/messages` | `conversations.reply` |

القراءة بمؤشر لا بصفحات، لأن المحادثة تنمو أثناء قراءتها:
`?limit=50&before=<messageId>` يُرجع `{ items, hasMore, nextBefore }` مرتبة من الأقدم للأحدث.

**رد الموظف** (`{ "content": "..." }`، حتى 4096 حرفاً) يُحفظ بحالة `PENDING`، وفي
المعاملة نفسها: يحوّل المحادثة إلى HUMAN، يعيد فتحها إن كانت منتهية، يسندها للموظف إن لم
تكن مسندة، ويصفّر غير المقروء. الإرسال الفعلي للقناة يأتي مع المرحلة 5.

### الزمن الحقيقي (Socket.IO)

```
path:  /api/socket.io          auth: { token: "<accessToken>" }
```

| الحدث | الاتجاه | المحتوى |
| --- | --- | --- |
| `conversation:join` | عميل → خادم | `{ conversationId }` ← ack `{ ok, code? }` |
| `conversation:leave` | عميل → خادم | `{ conversationId }` |
| `conversation:updated` | خادم → عميل | صف صندوق المحادثات كاملاً، لكل من يملك `conversations.read` |
| `message:created` | خادم → عميل | `{ conversationId, message }` لمن انضم لغرفة المحادثة |

رفض الاتصال يصل في `connect_error` ورسالته رمز الخطأ: `TOKEN_EXPIRED` (جدّد الرمز وأعد
الاتصال) أو `UNAUTHENTICATED` / `TOKEN_INVALID` (توقف). الخادم يغلق الاتصال عند انتهاء
صلاحية الرمز، فيعيد العميل الاتصال برمز جديد وصلاحيات محدّثة.

### سجل العمليات

| الطريقة | المسار | الصلاحية |
| --- | --- | --- |
| `GET` | `/audit-logs` | `audit.read` |

مرشّحات: `entity`، `entityId`، `action`، `userId`، `from`، `to` (ISO 8601).

### فحص الخدمة

```
🔓 GET /health        حالة الخدمة وقاعدة البيانات (readiness)
🔓 GET /health/live   حياة الحاوية (liveness)
```

خارج بادئة `/api/v1` عمداً، ليستخدمها الموازن وفحوص الحاوية مباشرة.

---

## 5. كتالوج الصلاحيات

42 صلاحية بصيغة `<group>.<action>`:

| المجموعة | الصلاحيات |
| --- | --- |
| `company` | `read` · `update` |
| `users` | `read` · `create` · `update` · `delete` |
| `roles` | `read` · `create` · `update` · `delete` |
| `products` | `read` · `create` · `update` · `delete` |
| `categories` | `read` · `create` · `update` · `delete` |
| `inventory` | `read` · `adjust` |
| `customers` | `read` · `create` · `update` · `delete` |
| `conversations` | `read` · `reply` · `assign` · `close` |
| `orders` | `read` · `create` · `update` · `delete` |
| `channels` | `read` · `manage` |
| `ai` | `settings.read` · `settings.update` |
| `reports` | `read` |
| `billing` | `read` · `manage` |
| `audit` | `read` |
| `platform` | `companies.read` · `companies.manage` (مدير المنصة فقط) |

المصدر الوحيد للحقيقة: `apps/api/src/common/constants/permissions.constant.ts`.
البذور تُزامن الجدول معه وتحذف ما أُزيل منه.

---

## 6. النقاط المخططة

| المرحلة | النقاط |
| --- | --- |
| 4 | `/orders` · `/orders/:id/status` · `/orders/:id/items` |
| 5 | `/channels` · `/webhooks/whatsapp` · `/webhooks/instagram` · `/webhooks/facebook` |
| 6 | `/ai/config` · `/ai/test` · `/conversations/:id/handover` |
| 7 | `/dashboard/summary` · `/reports/*` · `/notifications` |
| 8 | `/billing/subscription` · `/billing/invoices` · `/billing/usage` |
