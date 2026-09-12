import { ref, shallowRef } from 'vue';
import { ApiError } from '@/types/api';

/**
 * Wraps a fetch function with the loading / error / empty states every list screen
 * needs, so views stop re-implementing the same three refs and try-catch.
 */
export function useAsyncData<T>(loader: () => Promise<T>, initial: T) {
  const data = shallowRef<T>(initial);
  const loading = ref(false);
  const error = ref<ApiError | null>(null);
  const loaded = ref(false);

  async function execute(): Promise<void> {
    loading.value = true;
    error.value = null;

    try {
      data.value = await loader();
      loaded.value = true;
    } catch (caught) {
      error.value =
        caught instanceof ApiError
          ? caught
          : new ApiError('حدث خطأ غير متوقع', 'INTERNAL_ERROR', 0);
    } finally {
      loading.value = false;
    }
  }

  return { data, loading, error, loaded, execute };
}
