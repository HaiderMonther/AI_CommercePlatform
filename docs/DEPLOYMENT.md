# Deployment — AI Commerce Platform

## 1. المتطلبات

| العنصر | الحد الأدنى | موصى به للإنتاج |
| --- | --- | --- |
| CPU | 2 vCPU | 4 vCPU |
| RAM | 4 GB | 8 GB |
| القرص | 20 GB | 80 GB SSD |
| Docker | 24+ | 24+ |
| PostgreSQL | 16 | 16 (مُدار مع نسخ احتياطي) |
| Redis | 7 | 7 (مع AOF) |

---

## 2. النشر عبر docker compose

```bash
git clone <repo> && cd AI_CommercePlatform
cp .env.example .env
```

**أنشئ الأسرار** — الـAPI يرفض الإقلاع بأسرار قصيرة أو متطابقة:

```bash
echo "JWT_SECRET=$(openssl rand -base64 48)"
echo "JWT_REFRESH_SECRET=$(openssl rand -base64 48)"
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -base64 24)"
```

ضع القيم في `.env` ثم:

```bash
docker compose up -d --build
docker compose run --rm migrate     # المايكريشن + بيانات النظام الأساسية
docker compose ps
curl -fsS http://localhost:3000/health
```

| الخدمة | المنفذ الافتراضي |
| --- | --- |
| الواجهة (nginx) | 8080 |
| الـAPI | 3000 |
| PostgreSQL | 5432 |
| Redis | 6379 |

> في الإنتاج لا تنشر منفذي PostgreSQL و Redis خارج شبكة Docker: احذف قسم `ports`
> من الخدمتين ليصلهما الـAPI عبر الشبكة الداخلية فقط.

---

## 3. متغيرات البيئة

### مطلوبة

| المتغير | الوصف |
| --- | --- |
| `DATABASE_URL` | سلسلة اتصال PostgreSQL |
| `JWT_SECRET` | سر رمز الدخول — 32 حرفاً على الأقل |
| `JWT_REFRESH_SECRET` | سر رمز التحديث — **يجب أن يختلف** عن السابق |
| `ENCRYPTION_KEY` | مفتاح تشفير بيانات القنوات — 32 حرفاً على الأقل |

التحقق يجري عند الإقلاع (`env.validation.ts`): سر قصير أو سران متطابقان يوقفان
الخدمة بدل أن تعمل بإعداد غير آمن.

### اختيارية

| المتغير | الافتراضي | الوصف |
| --- | --- | --- |
| `NODE_ENV` | `development` | بيئة التشغيل |
| `PORT` | `3000` | منفذ الـAPI |
| `API_PREFIX` | `api/v1` | بادئة المسارات |
| `REDIS_URL` | `redis://localhost:6379` | الكاش والطوابير وبث الزمن الحقيقي بين نسخ الـAPI |
| `JWT_EXPIRES_IN` | `15m` | عمر رمز الدخول |
| `JWT_REFRESH_EXPIRES_IN` | `30d` | عمر رمز التحديث |
| `CORS_ORIGINS` | `FRONTEND_URL` | مصادر مسموحة مفصولة بفواصل |
| `THROTTLE_LIMIT` | `120` | طلب/دقيقة لكل IP |
| `THROTTLE_AUTH_LIMIT` | `10` | محاولة مصادقة/دقيقة لكل IP |
| `SWAGGER_ENABLED` | `true` | **اجعله `false` في الإنتاج** |
| `LOG_LEVEL` | `log` | مستوى السجل |

### قنوات Meta (المرحلة 5)

| المتغير | الافتراضي | الوصف |
| --- | --- | --- |
| `META_APP_SECRET` | — | يتحقق من توقيع كل webhook. **إلزامي في الإنتاج**: بدونه تُرفض كل الأحداث |
| `META_VERIFY_TOKEN` | — | نص عشوائي (16 حرفاً على الأقل) يُكتب نفسه في إعداد الـwebhook في تطبيق Meta |
| `META_GRAPH_VERSION` | `v21.0` | إصدار Graph API |
| `ENCRYPTION_KEY` | — | يشفّر رموز وصول القنوات. **تغييره يُبطل الرموز المخزّنة** فيجب إدخالها من جديد |
| `WORKER_SWEEP_INTERVAL_MS` | `15000` | كنس الأحداث والردود المتأخرة؛ `0` يعطّله |
| `META_APP_ID` | — | للمرجع فقط حالياً |

**ربط Meta خطوة بخطوة**

1. في تطبيق Meta (developers.facebook.com) أضف منتجات WhatsApp و/أو Messenger و/أو Instagram.
2. Webhooks ← عنوان الاستدعاء: `https://<النطاق>/api/v1/webhooks/whatsapp` (أو `facebook` /
   `instagram`)، ورمز التحقق = `META_VERIFY_TOKEN`. اشترك في حقل `messages`
   (وفي ماسنجر/إنستغرام: `messages` و`message_deliveries`).
3. أنشئ System User في Business Manager برمز دائم بصلاحيات `whatsapp_business_messaging`
   أو `pages_messaging` / `instagram_manage_messages`.
4. في لوحة المتجر ← القنوات ← ربط قناة: المعرف والرمز. يُفحص الاتصال فوراً.

### الذكاء الاصطناعي (المرحلة 6)

| المتغير | الافتراضي | الوصف |
| --- | --- | --- |
| `AI_API_KEY` | — | مفتاح Claude API من console.anthropic.com. بدونه يبقى المساعد متوقفاً وتصل كل المحادثات للموظفين |
| `AI_MODEL` | `claude-opus-5-5` | النموذج للشركات التي لم تختر نموذجاً |
| `AI_REPLY_DELAY_MS` | `1500` | انتظار قبل الرد لتجميع رسائل الزبون المتتابعة |

**التكلفة:** كل رد يُسجَّل في `ai_interactions` بالرموز، ويُجمع يومياً في `usage_records`
(`AI_MESSAGES` و`AI_TOKENS`) لكل شركة. Claude Haiku 5.5 أرخص بكثير لمتجر عالي الحجم،
ويُختار من إعدادات المساعد.

---

### الاشتراكات (المرحلة 8)

| المتغير | الافتراضي | الوصف |
| --- | --- | --- |
| `BILLING_INTERVAL_MS` | `3600000` | كم مرة تُراجع الاشتراكات (التجديد، الفواتير، التأخر، الانتهاء)؛ `0` يعطّله |

الباقات وأسعارها وحدودها في `seedPlans` بـ`prisma/seed.ts`، وتُزامن مع كل تشغيل للبذور
(`--reference-only` يكفي). تغيير سعر لا يمس الفواتير الصادرة.

**تسجيل الدفعات:** مدير المنصة ← الشركات المشتركة ← الشركة ← الفواتير ← «تسجيل الدفع» بعد
التأكد من وصول التحويل. لا توجد بوابة دفع إلكترونية بعد.

---

## 4. المايكريشن

```bash
# إنتاج — تطبيق المايكريشن الموجودة فقط
docker compose run --rm migrate

# تطوير — إنشاء مايكريشن جديدة بعد تعديل schema.prisma
cd apps/api && npm run db:migrate:dev -- --name add_products
```

خدمة `migrate` منفصلة عن الـAPI عمداً: عند تشغيل عدة نسخ من الـAPI خلف موازن،
دمج المايكريشن داخل إقلاع الـAPI يجعل النسخ تتسابق على نفس المايكريشن.

**قواعد المايكريشن الآمنة**

1. لا تحذف عموداً في نفس الإصدار الذي يتوقف عن استخدامه — أطلق الكود أولاً، ثم احذف
   العمود في الإصدار التالي. هذا يبقي التراجع ممكناً.
2. أضف الأعمدة الجديدة `nullable` أو بقيمة افتراضية، وإلا فشلت المايكريشن على جدول
   غير فارغ.
3. الفهارس على الجداول الكبيرة تُنشأ بـ`CREATE INDEX CONCURRENTLY` في مايكريشن يدوي
   لتجنّب قفل الجدول.
4. خذ نسخة احتياطية قبل أي مايكريشن في الإنتاج.

---

## 5. النسخ الاحتياطي والاستعادة

```bash
# نسخة يومية مضغوطة
docker compose exec -T postgres pg_dump -U aicommerce -Fc ai_commerce \
  > "backup-$(date +%F).dump"

# الاستعادة
docker compose exec -T postgres pg_restore -U aicommerce -d ai_commerce --clean --if-exists \
  < backup-2026-03-15.dump
```

**سياسة موصى بها**

| العنصر | التوصية |
| --- | --- |
| التكرار | يومي كامل + WAL archiving للاستعادة لنقطة زمنية |
| الاحتفاظ | 7 يومية · 4 أسبوعية · 12 شهرية |
| التخزين | خارج الخادم (S3 أو ما يعادله)، مشفّر |
| الاختبار | استعادة تجريبية شهرية — نسخة لم تُختبر ليست نسخة |

Redis يحمل بث الزمن الحقيقي بين النسخ فقط. الرسائل الواردة والصادرة تنتظر في PostgreSQL
(`webhook_events` و`messages`)، فلا يضيع شيء بفقدان Redis، وتشملها النسخة الاحتياطية للقاعدة.

---

## 6. المراقبة

### فحوص الجاهزية

| المسار | الاستخدام |
| --- | --- |
| `/health` | readiness — يتحقق من قاعدة البيانات، للموازن |
| `/health/live` | liveness — حيّة الحاوية، لإعادة التشغيل التلقائي |

كلا الحاويتين تحملان `HEALTHCHECK` داخلياً.

### السجلات

سجل الوصول بصيغة JSON لكل طلب:

```json
{ "correlationId": "9f1c...", "method": "POST", "path": "/api/v1/orders",
  "statusCode": 201, "durationMs": 87, "companyId": "c...", "userId": "c...", "ip": "..." }
```

```bash
docker compose logs -f api
docker compose logs api | grep '"statusCode":5'      # أخطاء الخادم
docker compose logs api | grep '<correlationId>'     # تتبع طلب واحد
```

`correlationId` يربط سطر السجل بسجل التدقيق وبالاستجابة التي رآها المستخدم — وهو
نقطة البداية الطبيعية لأي تحقيق.

### مؤشرات تستحق التنبيه

| المؤشر | العتبة المقترحة |
| --- | --- |
| نسبة الأخطاء 5xx | > 1% خلال 5 دقائق |
| زمن الاستجابة p95 | > 1 ثانية |
| فشل فحص الجاهزية | مرتان متتاليتان |
| اتصالات PostgreSQL | > 80% من الحد الأقصى |
| `webhook_events` بحالة `FAILED` و`attempts = 5` | أي ظهور — حدث لن يُعاد تلقائياً |
| رسائل صادرة `PENDING` أقدم من 5 دقائق | > 0 مستمر — Meta لا تستجيب أو القناة معطلة |
| قنوات بحالة `ERROR` | أي قناة — غالباً رمز وصول منتهٍ |
| `ai_interactions.success = false` | > 5% خلال ساعة — مفتاح خاطئ أو حدود معدل |
| `auth.token_reuse_detected` في سجل التدقيق | أي ظهور — مؤشر سرقة رمز |

---

## 7. قائمة التحقق قبل الإنتاج

**الأمان**
- [ ] كل الأسرار مولّدة عشوائياً وغير القيم الافتراضية
- [ ] `JWT_SECRET` و `JWT_REFRESH_SECRET` مختلفان
- [ ] `SWAGGER_ENABLED=false`
- [ ] `CORS_ORIGINS` يحوي النطاقات الفعلية فقط — لا `*`
- [ ] TLS مفعّل (Let's Encrypt أو شهادة الجهة)
- [ ] منفذا PostgreSQL و Redis غير منشورين خارجياً
- [ ] تغيير كلمة مرور حساب مدير المنصة الافتراضي
- [ ] `NODE_ENV=production`

**الموثوقية**
- [ ] النسخ الاحتياطي مجدول ومُختبر
- [ ] فحوص الجاهزية موصولة بالموازن
- [ ] `restart: unless-stopped` على كل الخدمات
- [ ] حدود موارد محددة لكل حاوية

**قبل إطلاق المرحلة 5**
- [ ] `META_VERIFY_TOKEN` مضبوط ومطابق لإعداد Meta
- [ ] عنوان الـwebhook يعمل عبر HTTPS من الإنترنت العام
- [ ] التحقق من توقيع الـwebhook مفعّل ومختبر

---

## 8. التوسّع

```
                  ┌── api (نسخة 1) ──┐
Load Balancer ────┼── api (نسخة 2) ──┼──▶ PostgreSQL (primary + read replica)
                  └── api (نسخة 3) ──┘        Redis (كاش + طوابير)
```

الـAPI **عديم الحالة**: الجلسات في قاعدة البيانات لا في الذاكرة، لذا التوسّع الأفقي
لا يتطلب sticky sessions. نقاط الانتباه عند التوسّع:

1. **المايكريشن** عبر خدمة `migrate` وحدها، لا من نسخ الـAPI.
2. **WebSocket** يبث بين النسخ عبر Redis adapter تلقائياً. إن تعذّر Redis عند الإقلاع
   تعمل كل نسخة وحدها ويُسجَّل تحذير — مقبول لنسخة واحدة، لا لعدة نسخ.
3. **الوارد والصادر** يتوزعان بين النسخ تلقائياً: كل نسخة تكنس، والمطالبة الذرّية تمنع التكرار.
4. **القراءة** التقارير استعلامات تجميع على الجداول الأساسية؛ عند كبر البيانات يمكن توجيهها إلى read replica دون تغيير المنطق.

---

## 9. CI/CD

`.github/workflows/ci.yml` يشغّل على كل push و pull request:

```
Lint → Typecheck → Unit tests → Migrate → Seed → E2E tests → Build → Docker build
```

اختبارات الـE2E تعمل على PostgreSQL و Redis حقيقيين كخدمات في الـworkflow، وتشمل
مجموعة عزل الشركات — وهي التي تمنع إطلاق تغيير يسرّب بيانات بين المستأجرين.

للنشر: أضف خطوة `docker/build-push-action` بـ`push: true` نحو سجل الصور، ثم
`docker compose pull && docker compose up -d` على الخادم عبر SSH أو webhook.
