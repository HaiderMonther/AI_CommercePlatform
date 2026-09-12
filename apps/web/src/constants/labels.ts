/** Arabic labels for API enums, kept in one place so wording stays consistent. */
export const USER_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'فعال',
  INVITED: 'بانتظار التفعيل',
  SUSPENDED: 'موقوف',
};

export const USER_STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'success',
  INVITED: 'warning',
  SUSPENDED: 'error',
};

export const COMPANY_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'فعالة',
  TRIAL: 'فترة تجريبية',
  SUSPENDED: 'موقوفة',
  CANCELLED: 'ملغاة',
};

export const PLAN_LABELS: Record<string, string> = {
  BASIC: 'الأساسية',
  BUSINESS: 'الأعمال',
  ENTERPRISE: 'المؤسسات',
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'auth.login': 'تسجيل دخول',
  'auth.login_failed': 'محاولة دخول فاشلة',
  'auth.logout': 'تسجيل خروج',
  'auth.register': 'تسجيل شركة جديدة',
  'auth.password_changed': 'تغيير كلمة المرور',
  'auth.token_reuse_detected': 'محاولة إعادة استخدام رمز',
  create: 'إنشاء',
  update: 'تعديل',
  delete: 'حذف',
  status_change: 'تغيير الحالة',
  permissions_changed: 'تعديل الصلاحيات',
};

export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  Auth: 'المصادقة',
  Company: 'الشركة',
  User: 'المستخدم',
  Role: 'الدور',
  Product: 'المنتج',
  Category: 'التصنيف',
  Inventory: 'المخزون',
  Customer: 'الزبون',
  Order: 'الطلب',
  Channel: 'القناة',
  AiConfig: 'إعدادات الذكاء الاصطناعي',
};

/** Arabic messages for the API's stable error codes. */
export const ERROR_CODE_LABELS: Record<string, string> = {
  INVALID_CREDENTIALS: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
  UNAUTHENTICATED: 'انتهت الجلسة، الرجاء تسجيل الدخول',
  TOKEN_EXPIRED: 'انتهت صلاحية الجلسة',
  REFRESH_TOKEN_REUSED: 'تم إنهاء الجلسة لأسباب أمنية، الرجاء تسجيل الدخول مجدداً',
  PERMISSION_DENIED: 'ليس لديك صلاحية لتنفيذ هذه العملية',
  RATE_LIMITED: 'عدد المحاولات كبير، الرجاء المحاولة بعد قليل',
  NETWORK_ERROR: 'تعذر الاتصال بالخادم، تحقق من الإنترنت',
};
