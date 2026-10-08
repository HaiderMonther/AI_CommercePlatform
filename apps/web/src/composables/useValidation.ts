type Rule = (value: unknown) => true | string;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Arabic-Indic digits are accepted too; the API normalizes them.
const PHONE_PATTERN = /^\+?[0-9\u0660-\u0669\u06F0-\u06F9\s-]{7,}$/;
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

/**
 * Client-side rules that mirror the API DTOs. They exist for fast feedback only —
 * the API validates every field again and is the authority.
 */
export const rules = {
  required:
    (message = 'هذا الحقل مطلوب'): Rule =>
    (value) =>
      (typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined) ||
      message,

  email:
    (message = 'البريد الإلكتروني غير صالح'): Rule =>
    (value) =>
      !value || EMAIL_PATTERN.test(String(value)) || message,

  phone:
    (message = 'رقم الهاتف غير صالح'): Rule =>
    (value) =>
      !value || PHONE_PATTERN.test(String(value)) || message,

  password:
    (message = 'يجب أن تحتوي على 8 أحرف على الأقل مع حرف كبير وحرف صغير ورقم'): Rule =>
    (value) =>
      PASSWORD_PATTERN.test(String(value ?? '')) || message,

  minLength:
    (min: number, message?: string): Rule =>
    (value) =>
      String(value ?? '').trim().length >= min || message || `يجب ألا يقل عن ${min} أحرف`,

  maxLength:
    (max: number, message?: string): Rule =>
    (value) =>
      String(value ?? '').length <= max || message || `يجب ألا يزيد عن ${max} حرف`,

  matches:
    (other: () => unknown, message = 'القيمتان غير متطابقتين'): Rule =>
    (value) =>
      value === other() || message,
};
