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
| `ORDER_NOT_FOUND` | 404 | الطلب غير موجود |
| `INSUFFICIENT_STOCK` | 409 | الكمية غير متوفرة (`details.productId`، `details.variantId`) |
| `PRODUCT_UNAVAILABLE` | 400 | المنتج أو المتغير موقوف عن البيع |
| `ORDER_INVALID_TRANSITION` | 409 | انتقال غير مسموح في دورة حياة الطلب (`details.allowed`) |
| `ORDER_NOT_EDITABLE` | 409 | الطلب في حالة لا تسمح بهذا التعديل |
| `ORDER_CREATE_FAILED` | 409 | تعارض متزامن أثناء إنشاء الطلب، أعد المحاولة |
| `CHANNEL_NOT_FOUND` | 404 | القناة غير موجودة |
| `CHANNEL_ALREADY_CONNECTED` | 409 | الحساب مربوط بهذا المتجر أو بمتجر آخر |
| `CHANNEL_NOT_CONFIGURED` | 400/500 | لا يوجد رمز وصول، أو `ENCRYPTION_KEY` غير مضبوط |
| `WEBHOOK_SIGNATURE_INVALID` | 401 | توقيع Meta مفقود أو غير صحيح |
| `MESSAGE_NOT_RETRYABLE` | 409 | إعادة الإرسال للرسائل الصادرة الفاشلة فقط |
| `AI_NOT_CONFIGURED` | 503 | `AI_API_KEY` غير مضبوط على الخادم |
| `AI_PROVIDER_ERROR` | 502 | فشل استدعاء Claude API أثناء التجربة |
| `PLAN_LIMIT_REACHED` | 402 | تجاوز حد الباقة (`details.metric`، `limit`، `used`) |
| `SUBSCRIPTION_INACTIVE` | 402 | الاشتراك منتهٍ أو ملغى |
| `PLAN_DOWNGRADE_BLOCKED` | 409 | الباقة الأصغر لا تتسع لبيانات المتجر (`details.conflicts`) |
| `PLAN_NOT_FOUND` · `INVOICE_NOT_FOUND` · `COMPANY_NOT_FOUND` | 404 | غير موجود |
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
| `POST` | `/conversations/:id/messages/:messageId/retry` | `conversations.reply` |

القراءة بمؤشر لا بصفحات، لأن المحادثة تنمو أثناء قراءتها:
`?limit=50&before=<messageId>` يُرجع `{ items, hasMore, nextBefore }` مرتبة من الأقدم للأحدث.

**رد الموظف** (`{ "content": "..." }`، حتى 4096 حرفاً) يُحفظ بحالة `PENDING`، وفي
المعاملة نفسها: يحوّل المحادثة إلى HUMAN، يعيد فتحها إن كانت منتهية، يسندها للموظف إن لم
تكن مسندة، ويصفّر غير المقروء. بعد الحفظ يُرسل للقناة في الخلفية، وتتقدم حالته
`PENDING → SENT → DELIVERED → READ` مع إيصالات Meta، أو تصبح `FAILED` مع `failureReason`
بالعربية (انتهاء نافذة الـ24 ساعة، رمز قناة منتهٍ، لا توجد قناة مفعّلة…). الرد الفاشل يُعاد
إرساله بـ`/retry` بعد إصلاح السبب.

### القنوات

| الطريقة | المسار | الصلاحية |
| --- | --- | --- |
| `GET` | `/channels` | `channels.read` |
| `GET` | `/channels/:id` | `channels.read` |
| `POST` | `/channels` | `channels.manage` |
| `PATCH` | `/channels/:id` | `channels.manage` |
| `POST` | `/channels/:id/verify` | `channels.manage` |
| `DELETE` | `/channels/:id` | `channels.manage` |

```json
{ "type": "WHATSAPP", "name": "واتساب المبيعات", "externalId": "106540352242922", "accessToken": "EAAG..." }
```

| القناة | `externalId` |
| --- | --- |
| `WHATSAPP` | Phone number ID (من WhatsApp Manager، لا رقم الهاتف) |
| `FACEBOOK` | Page ID |
| `INSTAGRAM` | Instagram business account ID |

- رمز الوصول يُشفَّر (AES-256-GCM بمفتاح `ENCRYPTION_KEY`) **ولا يُعاد أبداً**؛ الاستجابة تحمل
  `hasAccessToken` و`tokenHint` (آخر 4 أحرف) فقط.
- الإضافة وتغيير الرمز يفحصانه لدى Meta فوراً: النتيجة في `status`
  (`CONNECTED` · `ERROR` · `DISCONNECTED`) و`lastError`. الحفظ يتم حتى لو فشل الفحص.
- الحساب الواحد يُربط بمتجر واحد على المنصة (`409 CHANNEL_ALREADY_CONNECTED`)، وإلا انقسمت رسائله.
- `isActive: false` يوقف القناة: رسائلها الواردة تُتجاهل ولا يُرسل منها.
- كل قناة تحمل `webhookPath` — العنوان الذي يُوضع في تطبيق Meta.

### Webhooks (عامة، لـMeta فقط)

```
GET   /webhooks/{whatsapp|instagram|facebook}   تحقق Meta: يُرجع hub.challenge نصاً
POST  /webhooks/{whatsapp|instagram|facebook}   الأحداث، موقّعة بـX-Hub-Signature-256
```

- **التحقق** ينجح فقط إذا طابق `hub.verify_token` قيمة `META_VERIFY_TOKEN`، وإلا `403`.
- **التوقيع** HMAC-SHA256 للبايتات الخام بـ`META_APP_SECRET`؛ غيابه أو خطؤه `401
  WEBHOOK_SIGNATURE_INVALID` دون تخزين شيء. بدون `META_APP_SECRET` تُقبل الطلبات غير الموقّعة
  في التطوير فقط (مع `signatureValid: false`)، وتُرفض في الإنتاج.
- **الرد فوري**: يُحلَّل الطلب ويُخزَّن كل حدث في `webhook_events` ثم يُرد `200`
  بـ`{ received, queued }`، والمعالجة بعد الرد.
- **Idempotent**: المفتاح الفريد `(channel, externalEventId)` يجعل إعادة إرسال Meta لنفس الحدث
  بلا أثر (`queued: 0`).
- الحدث لحساب غير مربوط يُخزَّن `IGNORED` بلا شركة.

| النوع | يُحوَّل إلى |
| --- | --- |
| واتساب: نص، صورة، صوت، فيديو، ملف، موقع، ملصق، رد زر | رسالة واردة (`type` المناسب، والوسائط بنص بديل مثل `[صورة]`) |
| ماسنجر وإنستغرام: نص ومرفقات | رسالة واردة (`mediaUrl` من Meta) |
| واتساب `statuses` · ماسنجر `delivery` | تحديث حالة رسالة صادرة (للأمام فقط) |
| رسائل الصدى `is_echo` وردود الفعل (reactions) | تُتجاهل |

### الطلبات

| الطريقة | المسار | الصلاحية |
| --- | --- | --- |
| `GET` | `/orders` | `orders.read` |
| `GET` | `/orders/stats` | `orders.read` |
| `GET` | `/orders/:id` | `orders.read` |
| `POST` | `/orders` | `orders.create` |
| `PATCH` | `/orders/:id` | `orders.update` |
| `PUT` | `/orders/:id/items` | `orders.update` |
| `PATCH` | `/orders/:id/status` | `orders.update` |
| `PATCH` | `/orders/:id/payment` | `orders.update` |
| `DELETE` | `/orders/:id` | `orders.delete` |

مرشّحات القائمة: `open=true` (لم يُسلَّم ولم يُلغَ)، `status`، `paymentStatus`، `deliveryStatus`،
`source`، `customerId`، `conversationId`، `from`/`to`، و`search` برقم الطلب (`1001` أو `#1001`)
أو اسم الزبون أو هاتفه. `sortBy` من `createdAt|orderNumber|total`.

**إنشاء طلب**

```json
{
  "customerId": "c...",
  "conversationId": "c...",
  "items": [
    { "productId": "c...", "quantity": 2 },
    { "productId": "c...", "variantId": "c...", "quantity": 1, "unitPrice": 20000, "discount": 1000 }
  ],
  "paymentMethod": "CASH_ON_DELIVERY",
  "deliveryFee": 5000,
  "discount": 0,
  "deliveryCity": "بغداد",
  "deliveryAddress": "المنصور",
  "notes": "الاتصال قبل التوصيل"
}
```

- الزبون إما `customerId` أو `customer: { name, phone, city?, address? }`. الثاني يُربط بزبون
  موجود بنفس الهاتف أو يُنشئ زبوناً جديداً.
- سعر الوحدة من الكتالوج إن لم يُرسل: سعر المتغير إن وُجد، وإلا سعر التخفيض، وإلا السعر الأساسي.
- اسم المستلم وهاتفه ومدينته وعنوانه تُنسخ من الزبون إن لم تُرسل، وتبقى ثابتة على الطلب
  حتى لو تغيّر ملف الزبون لاحقاً. كذلك اسم المنتج ورمزه وسعره على كل سطر.
- يُحجز المخزون في المعاملة نفسها. نقص أي منتج يرفض الطلب كاملاً بـ`409 INSUFFICIENT_STOCK`
  واسم المنتج، ولا يُحفظ شيء (ولا حتى الزبون الجديد).
- رقم الطلب تسلسلي لكل شركة يبدأ من `1001`.

**دورة الحياة** (`PATCH /:id/status` بـ`{ status, note?, cancelReason? }`)

```
NEW ─▶ CONFIRMED ─▶ PREPARING ─▶ SHIPPED ─▶ DELIVERED
 │         │            │           │
 └─────────┴────────────┴───────────┴──▶ CANCELLED   (cancelReason مطلوب)
```

| الانتقال | المخزون | حقول تتحدث |
| --- | --- | --- |
| إنشاء الطلب | `RESERVATION` (حجز) | — |
| ← `SHIPPED` أو `DELIVERED` | `RELEASE` + `SALE` (خصم فعلي) | `deliveryStatus`، `deliveredAt` |
| ← `CANCELLED` قبل الشحن | `RELEASE` | `cancelledAt`، `cancelReason` |
| ← `CANCELLED` بعد الشحن (رفض الاستلام) | `RETURN` | `deliveryStatus = RETURNED` |

يمكن القفز للأمام (تسليم مباشر من `NEW`) ولا يمكن الرجوع. `DELIVERED` و`CANCELLED` نهائيتان.
الانتقال غير المسموح يُرجع `409 ORDER_INVALID_TRANSITION` مع `details.allowed`. تفاصيل الطلب
تحمل `allowedTransitions` و`itemsEditable` و`pricingEditable` لترسم الواجهة الأزرار الصحيحة.

**التعديل**

| ما يتغير | متى |
| --- | --- |
| المنتجات (`PUT /:id/items` بقائمة كاملة) | `NEW` و`CONFIRMED` فقط؛ يُحجز أو يُفك حجز الفرق فقط |
| الخصم وأجور التوصيل | قبل الشحن |
| المستلم والعنوان و`deliveryStatus` اليدوي (`PENDING`·`ASSIGNED`·`IN_TRANSIT`·`FAILED`) | ما دام الطلب مفتوحاً |
| الملاحظات | دائماً |

غير ذلك يُرجع `409 ORDER_NOT_EDITABLE`.

**الدفع** — `PATCH /:id/payment` بـ`{ paidAmount, paymentMethod? }`. `paidAmount` هو **إجمالي
المستلم حتى الآن** لا دفعة إضافية، فتصحيح رقم خاطئ يكون بإدخال الصحيح. حالة الدفع تُحسب
منه (`UNPAID` · `PARTIALLY_PAID` · `PAID`)، وإلغاء طلب مدفوع يجعلها `REFUNDED`.
كل صف يحمل `balanceDue` (المتبقي).

**أرقام الزبون** — `totalOrders` (غير الملغاة)، و`totalSpent` و`outstandingDebt` (من الطلبات
المسلَّمة فقط)، و`lastOrderAt` تُعاد حسابها من الطلبات بعد كل تغيير، فلا تنحرف.

**الحذف** للطلبات الملغاة فقط؛ الطلب الحي يُلغى ليُفك حجزه عبر دورة الحياة.

### المساعد الذكي

| الطريقة | المسار | الصلاحية |
| --- | --- | --- |
| `GET` | `/ai/config` | `ai.settings.read` |
| `PATCH` | `/ai/config` | `ai.settings.update` |
| `POST` | `/ai/test` | `ai.settings.update` |

`GET /ai/config` يُنشئ الإعدادات الافتراضية أول مرة، ويُرجع معها `providerConfigured`
(هل `AI_API_KEY` مضبوط) و`options` (النماذج والأساليب واللغات المتاحة).

```json
{
  "enabled": true,
  "autoReply": true,
  "model": "claude-opus-5-5",
  "tone": "friendly",
  "language": "ar-IQ",
  "workingHours": "يومياً 10 صباحاً - 10 مساءً",
  "deliveryPolicy": "...",
  "returnPolicy": "...",
  "paymentMethods": ["CASH_ON_DELIVERY", "ZAIN_CASH"],
  "handoverKeywords": ["موظف", "شكوى"],
  "customInstructions": "..."
}
```

| الحقل | القيم |
| --- | --- |
| `model` | `claude-opus-5-5` · `claude-sonnet-5-5` · `claude-haiku-5-5` |
| `tone` | `friendly` · `formal` · `enthusiastic` |
| `language` | `ar-IQ` · `ar` · `en` |

`POST /ai/test` بـ`{ "message": "...", "history": [{ "role": "customer" | "assistant", "content": "..." }] }`
يشغّل المساعد بالإعدادات المحفوظة: يبحث في الكتالوج فعلياً، أما `create_order` فيتحقق دون
إنشاء، والتحويل يُبلَّغ فقط. يُرجع `reply` و`handoverReason` و`toolCalls` و`usage` و`latencyMs`.
محدود بـ20 طلباً في الدقيقة لأنه يستهلك رموزاً. بدون مفتاح: `503 AI_NOT_CONFIGURED`.

**الرد التلقائي** لا نقطة له: يعمل عند كل رسالة واردة في محادثة بوضع `AI`، إذا كان المساعد
والرد التلقائي مفعّلين والزبون فعّالاً. ردوده رسائل `senderType: AI` تمر بنفس مسار الإرسال
وإيصالات التسليم، والطلبات التي ينشئها بمصدر `AI`. التحويل لموظف يغيّر `mode` إلى `HUMAN`
مع `handoverReason`، ويصل للفريق عبر `conversation:updated`.

### لوحة التحكم

| الطريقة | المسار | الصلاحية |
| --- | --- | --- |
| `GET` | `/dashboard/summary` | أي عضو |

يُرجع أقساماً، وكل قسم `null` لمن لا يملك صلاحيته، فلا تصل أرقام المبيعات لمن لا يرى الطلبات:

| القسم | الصلاحية | المحتوى |
| --- | --- | --- |
| `sales` | `orders.read` | اليوم، آخر 30 يوماً مع التغير عن الفترة السابقة، اتجاه 14 يوماً، الطلبات المفتوحة حسب الحالة، آخر الطلبات |
| `conversations` | `conversations.read` | المفتوحة، غير المقروءة، بانتظار موظف، المسندة إليّ |
| `inventory` | `inventory.read` | عدد المنخفض والنافد وأدناها مخزوناً |
| `customers` | `customers.read` | الإجمالي والجدد خلال 30 يوماً |
| `ai` | `reports.read` | ملخص نشاط المساعد لآخر 30 يوماً |

### التقارير

| الطريقة | المسار | الصلاحية |
| --- | --- | --- |
| `GET` | `/reports/sales` | `reports.read` |
| `GET` | `/reports/products` | `reports.read` |
| `GET` | `/reports/conversations` | `reports.read` |
| `GET` | `/reports/ai` | `reports.read` |
| `GET` | `/reports/orders/export` | `reports.read` + `orders.read` |

كلها تقبل `from` و`to` بصيغة `YYYY-MM-DD` (شاملة)، والافتراضي آخر 30 يوماً حتى اليوم، وأقصاها
366 يوماً. **الأيام تُقطع بتوقيت الشركة** (`Company.timezone`، بغداد افتراضاً)، فطلب الساعة
1 فجراً يُحسب ليومه لا لليوم السابق بتوقيت UTC.

- **المبيعات:** قيمة وعدد الطلبات غير الملغاة بتاريخ الإنشاء، والتغير عن الفترة السابقة بنفس
  الطول، والإيراد المُسلَّم بتاريخ التسليم، وسلسلة يومية بكل أيام الفترة (الأيام الهادئة صفر)،
  والتوزيع حسب الحالة والمصدر وطريقة الدفع وأكثر 8 مدن.
- **المنتجات:** الأعلى إيراداً والأكثر كمية من أسطر الطلبات غير الملغاة، مع المخزون الحالي.
- **المحادثات:** الجديدة حسب القناة، رسائل الزبائن وردود المساعد والموظفين، والتحويلات.
- **المساعد الذكي:** الردود ونسبة نجاحها، التحويلات، الرموز، متوسط زمن الرد، طلباته وقيمتها،
  و`automationRate`: نسبة المحادثات الجديدة التي لم يحتج فيها أحد للتدخل. تجارب صفحة الإعدادات
  لا تُحسب.
- **التصدير:** ملف CSV بكل طلبات الفترة (حتى 50 ألفاً)، مع BOM ليفتحه Excel بالعربية
  سليماً، والخلايا التي تبدأ بـ`= + - @` تُحيَّد ضد حقن الصيغ (عدا أرقام الهواتف).

### الإشعارات

| الطريقة | المسار | الصلاحية |
| --- | --- | --- |
| `GET` | `/notifications` | أي عضو (إشعاراته فقط) |
| `GET` | `/notifications/unread-count` | أي عضو |
| `POST` | `/notifications/:id/read` | أي عضو |
| `POST` | `/notifications/read-all` | أي عضو |

`GET /notifications?unread=true&page=1&limit=20` يُرجع `{ items, unread, meta }`. كل إشعار
صف لمستلمه، فيقرأ كل شخص ويمسح ما يخصه. صاحب الحدث لا يُبلَّغ بما فعله بنفسه.

| النوع | متى | لمن | `data` |
| --- | --- | --- | --- |
| `NEW_ORDER` | طلب جديد (من المساعد أو موظف) | `orders.read` | `orderId`، `orderNumber` |
| `LOW_STOCK` | منتج وصل حد إعادة الطلب بعد شحن أو تعديل مخزون | `inventory.read` | `productId`، `stock` |
| `HUMAN_HANDOVER` | المساعد حوّل محادثة لموظف | المسند إليه، وإلا `conversations.reply` | `conversationId` |
| `CHANNEL_ERROR` | قناة فشل رمزها لدى Meta | `channels.manage` | `channelId` |

التكرار مكبوح: تنبيه المخزون مرة يومياً لكل منتج، والقناة كل 6 ساعات، والتحويل كل ساعة لنفس
المحادثة، ما دام الإشعار السابق غير مقروء.

### الاشتراك والباقات

| الطريقة | المسار | الصلاحية |
| --- | --- | --- |
| `GET` | `/billing/status` | أي عضو |
| `GET` | `/billing/plans` | `billing.read` |
| `GET` | `/billing/subscription` | `billing.read` |
| `GET` | `/billing/invoices` | `billing.read` |
| `POST` | `/billing/subscription/change` | `billing.manage` |
| `POST` | `/billing/subscription/cancel` | `billing.manage` |

**دورة الاشتراك**

```
تسجيل الشركة ─▶ TRIALING (14 يوماً، باقة BASIC)
                    │ نهاية الفترة
                    ▼
                 ACTIVE + فاتورة (مستحقة بعد 7 أيام) ──نهاية كل شهر──▶ فاتورة جديدة
                    │ تأخر الدفع                    │ إيقاف التجديد
                    ▼                                ▼
                 PAST_DUE (يعمل، فترة سماح 14 يوماً)  CANCELLED
                    │ انتهاء السماح
                    ▼
                 EXPIRED ──── تسجيل الدفع ────▶ ACTIVE
```

| الوضع (`standing`) | الحالات | الأثر |
| --- | --- | --- |
| `active` | `TRIALING` · `ACTIVE` | كل شيء يعمل |
| `grace` | `PAST_DUE` | يعمل، مع تنبيه للفريق |
| `restricted` | `EXPIRED` · `CANCELLED` | الدخول والبيانات متاحة، لكن المساعد الذكي متوقف ولا يمكن إضافة مستخدمين أو منتجات أو قنوات (`402 SUBSCRIPTION_INACTIVE`) |

**حدود الباقة** (`-1` = بلا حد):

| الحد | يُفحص عند | يُحسب |
| --- | --- | --- |
| `USERS` | إضافة مستخدم | المستخدمون غير المحذوفين |
| `PRODUCTS` | إضافة منتج | المنتجات غير المحذوفة |
| `CHANNELS` | ربط قناة | القنوات المربوطة |
| `AI_MESSAGES` | كل رد آلي | ردود المساعد في الفترة الحالية |

تجاوز الحد يُرجع `402 PLAN_LIMIT_REACHED` مع `details: { metric, limit, used }`. نفاد رصيد
المساعد يحوّل المحادثات للموظفين بدل إيقافها، وينبّه من يملك `billing.read` عند 80% وعند النفاد.

`POST /billing/subscription/change` بـ`{ "tier": "BUSINESS" }` يسري فوراً، والسعر الجديد من الفاتورة
القادمة. التخفيض يُرفض بـ`409 PLAN_DOWNGRADE_BLOCKED` إن تجاوز ما لدى المتجر حدود الباقة الجديدة
(`details.conflicts`). اشتراك منتهٍ أو ملغى يبدأ فترة جديدة بفاتورة. `POST /billing/subscription/cancel`
بـ`{ "cancel": true }` يوقف التجديد بنهاية الفترة، و`false` يتراجع.

**الدفع** يتم خارج المنصة (تحويل بنكي، زين كاش، FIB…) ويسجّله فريق المنصة.

### إدارة المنصة (مدير المنصة فقط)

| الطريقة | المسار | الصلاحية |
| --- | --- | --- |
| `GET` | `/platform/companies` | `platform.companies.read` |
| `GET` | `/platform/companies/:id` | `platform.companies.read` |
| `PATCH` | `/platform/companies/:id/status` | `platform.companies.manage` |
| `PATCH` | `/platform/companies/:id/subscription` | `platform.companies.manage` |
| `GET` | `/platform/invoices` | `platform.companies.read` |
| `POST` | `/platform/invoices/:id/pay` | `platform.companies.manage` |
| `POST` | `/platform/invoices/:id/void` | `platform.companies.manage` |

- `status: SUSPENDED` يمنع دخول كل أعضاء الشركة وينهي جلساتهم؛ `ACTIVE` يعيدهم.
- `subscription` بـ`{ "tier": "...", "extendDays": 7 }`: نقل لباقة دون فحص التخفيض، و/أو تمديد
  الفترة الحالية (أو التجريبية). تمديد اشتراك منتهٍ يعيد تشغيله حتى التاريخ الجديد.
- `pay` يسجّل الدفعة، ويعيد تشغيل الاشتراك إن كان متوقفاً بسببها ولم تبقَ فواتير أخرى.

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
| `message:updated` | خادم → عميل | `{ conversationId, message }` عند تغيّر حالة التسليم، لمن انضم للمحادثة |
| `notification:created` | خادم → عميل | الإشعار الجديد، لغرفة المستخدم نفسه فقط |
| `order:updated` | خادم → عميل | صف قائمة الطلبات كاملاً، أو `{ id, deleted: true }`، لكل من يملك `orders.read` |

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
