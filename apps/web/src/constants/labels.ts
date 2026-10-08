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
  Conversation: 'المحادثة',
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
  CUSTOMER_PHONE_TAKEN: 'رقم الهاتف مسجّل لزبون آخر',
  CUSTOMER_BLOCKED: 'الزبون محظور',
  ASSIGNEE_INVALID: 'لا يمكن إسناد المحادثة لهذا المستخدم',
};

// --- Catalog (Phase 2) -------------------------------------------------------

export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  STOCK_IN: 'إدخال مخزون',
  STOCK_OUT: 'إخراج مخزون',
  ADJUSTMENT: 'جرد وتعديل',
  SALE: 'بيع',
  RETURN: 'إرجاع',
  RESERVATION: 'حجز',
  RELEASE: 'فك حجز',
};

export const MOVEMENT_TYPE_COLORS: Record<string, string> = {
  STOCK_IN: 'success',
  RETURN: 'success',
  STOCK_OUT: 'error',
  SALE: 'error',
  ADJUSTMENT: 'info',
  RESERVATION: 'warning',
  RELEASE: 'warning',
};

/** Movement types an operator may trigger from the dashboard. */
export const MANUAL_MOVEMENT_TYPES = ['STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT', 'RETURN'] as const;

// --- CRM & messaging (Phase 3) -----------------------------------------------

export const CUSTOMER_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'فعّال',
  BLOCKED: 'محظور',
  ARCHIVED: 'مؤرشف',
};

export const CUSTOMER_STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'success',
  BLOCKED: 'error',
  ARCHIVED: 'default',
};

export const CHANNEL_LABELS: Record<string, string> = {
  WHATSAPP: 'واتساب',
  INSTAGRAM: 'إنستغرام',
  FACEBOOK: 'ماسنجر',
};

export const CHANNEL_ICONS: Record<string, string> = {
  WHATSAPP: 'mdi-whatsapp',
  INSTAGRAM: 'mdi-instagram',
  FACEBOOK: 'mdi-facebook-messenger',
};

export const CHANNEL_COLORS: Record<string, string> = {
  WHATSAPP: '#25D366',
  INSTAGRAM: '#E1306C',
  FACEBOOK: '#0084FF',
};

export const CONVERSATION_STATUS_LABELS: Record<string, string> = {
  OPEN: 'مفتوحة',
  PENDING: 'بانتظار الزبون',
  RESOLVED: 'تمت المعالجة',
  CLOSED: 'مغلقة',
};

export const CONVERSATION_STATUS_COLORS: Record<string, string> = {
  OPEN: 'primary',
  PENDING: 'warning',
  RESOLVED: 'success',
  CLOSED: 'default',
};

export const CONVERSATION_MODE_LABELS: Record<string, string> = {
  AI: 'المساعد الذكي',
  HUMAN: 'موظف',
};

export const DELIVERY_STATUS_ICONS: Record<string, string> = {
  PENDING: 'mdi-clock-outline',
  SENT: 'mdi-check',
  DELIVERED: 'mdi-check-all',
  READ: 'mdi-check-all',
  FAILED: 'mdi-alert-circle-outline',
};

export const DELIVERY_STATUS_LABELS: Record<string, string> = {
  PENDING: 'بانتظار الإرسال',
  SENT: 'أُرسلت',
  DELIVERED: 'وصلت',
  READ: 'قُرئت',
  FAILED: 'فشل الإرسال',
};

export const SENDER_LABELS: Record<string, string> = {
  CUSTOMER: 'الزبون',
  AI: 'المساعد الذكي',
  AGENT: 'موظف',
  SYSTEM: 'النظام',
};
