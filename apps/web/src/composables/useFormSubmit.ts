import { ref } from 'vue';
import { useUiStore } from '@/stores/ui.store';
import { ApiError } from '@/types/api';

/**
 * Standard submit handling: one in-flight guard, a toast on success, and field-level
 * validation details surfaced instead of a generic failure message.
 */
export function useFormSubmit() {
  const ui = useUiStore();
  const submitting = ref(false);
  const errorMessage = ref<string | null>(null);
  const fieldErrors = ref<string[]>([]);

  async function submit<T>(
    action: () => Promise<T>,
    options: { successMessage?: string; onSuccess?: (result: T) => void } = {},
  ): Promise<T | undefined> {
    if (submitting.value) return undefined;

    submitting.value = true;
    errorMessage.value = null;
    fieldErrors.value = [];

    try {
      const result = await action();
      if (options.successMessage) {
        ui.success(options.successMessage);
      }
      options.onSuccess?.(result);
      return result;
    } catch (caught) {
      if (caught instanceof ApiError) {
        errorMessage.value = caught.message;
        fieldErrors.value = caught.details ?? [];
      } else {
        errorMessage.value = 'حدث خطأ غير متوقع';
      }
      return undefined;
    } finally {
      submitting.value = false;
    }
  }

  return { submitting, errorMessage, fieldErrors, submit };
}
