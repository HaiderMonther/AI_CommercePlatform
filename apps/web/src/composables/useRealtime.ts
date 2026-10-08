import { onBeforeUnmount } from 'vue';
import { onRealtime } from '@/services/realtime';

/** Subscribes for the lifetime of the calling component. */
export function useRealtimeEvent<T>(event: string, handler: (payload: T) => void): void {
  const off = onRealtime<T>(event, handler);
  onBeforeUnmount(off);
}
