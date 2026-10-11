<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ConfirmDialog from '@/components/data/ConfirmDialog.vue';
import ErrorState from '@/components/data/ErrorState.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import OrderDetailsDialog from './components/OrderDetailsDialog.vue';
import OrderItemsDialog from './components/OrderItemsDialog.vue';
import OrderPaymentDialog from './components/OrderPaymentDialog.vue';
import OrderStatusDialog from './components/OrderStatusDialog.vue';
import { useAsyncData } from '@/composables/useAsyncData';
import { useRealtimeEvent } from '@/composables/useRealtime';
import {
  CHANNEL_ICONS,
  CHANNEL_LABELS,
  ORDER_DELIVERY_STATUS_LABELS,
  ORDER_SOURCE_LABELS,
  ORDER_STATUS_ACTIONS,
  ORDER_STATUS_COLORS,
  ORDER_STATUS_ICONS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_COLORS,
  PAYMENT_STATUS_LABELS,
} from '@/constants/labels';
import { PERMISSIONS } from '@/constants/permissions';
import { REALTIME_EVENT } from '@/services/realtime';
import { ordersService } from '@/services/orders.service';
import { useAuthStore } from '@/stores/auth.store';
import { useUiStore } from '@/stores/ui.store';
import { ApiError } from '@/types/api';
import type { OrderDetail, OrderEvent, OrderStatus } from '@/types/orders';
import { formatCurrency, formatDateTime } from '@/utils/format';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const ui = useUiStore();

const orderId = computed(() => String(route.params.id));

const { data: order, loading, error, execute } = useAsyncData<OrderDetail | null>(
  () => ordersService.get(orderId.value),
  null,
);

watch(orderId, execute, { immediate: true });

// Another agent (or the AI) changed this order: reload the full view.
useRealtimeEvent<OrderEvent>(REALTIME_EVENT.ORDER_UPDATED, (event) => {
  if (event.id !== orderId.value) return;
  if ('deleted' in event) {
    router.replace({ name: 'orders' });
    return;
  }
  if (order.value && event.updatedAt !== order.value.updatedAt) execute();
});

const canUpdate = computed(() => auth.can(PERMISSIONS.ORDERS_UPDATE));
const canDelete = computed(() => auth.can(PERMISSIONS.ORDERS_DELETE));
const canReadCustomers = computed(() => auth.can(PERMISSIONS.CUSTOMERS_READ));
const canReadConversations = computed(() => auth.can(PERMISSIONS.CONVERSATIONS_READ));

const statusTarget = ref<OrderStatus | null>(null);
const statusOpen = ref(false);
const paymentOpen = ref(false);
const detailsOpen = ref(false);
const itemsOpen = ref(false);
const deleteOpen = ref(false);
const deleting = ref(false);

/** The next step forward is the main action; skipping ahead stays in the menu. */
const nextStatus = computed(() =>
  order.value?.allowedTransitions.find((status) => status !== 'CANCELLED') ?? null,
);
const laterStatuses = computed(
  () =>
    order.value?.allowedTransitions.filter(
      (status) => status !== 'CANCELLED' && status !== nextStatus.value,
    ) ?? [],
);
const canCancel = computed(() => order.value?.allowedTransitions.includes('CANCELLED') ?? false);

function move(status: OrderStatus): void {
  statusTarget.value = status;
  statusOpen.value = true;
}

function onSaved(updated: OrderDetail): void {
  order.value = updated;
}

async function confirmDelete(): Promise<void> {
  if (!order.value) return;
  deleting.value = true;
  try {
    await ordersService.remove(order.value.id);
    ui.success('تم حذف الطلب');
    router.replace({ name: 'orders' });
  } catch (caught) {
    ui.error(caught instanceof ApiError ? caught.message : 'تعذر حذف الطلب');
  } finally {
    deleting.value = false;
  }
}

const subtitle = computed(() => {
  const value = order.value;
  if (!value) return '';
  return [
    formatDateTime(value.createdAt),
    ORDER_SOURCE_LABELS[value.source],
    value.createdByUser?.fullName,
  ]
    .filter(Boolean)
    .join(' · ');
});

const summaryRows = computed(() => {
  const value = order.value;
  if (!value) return [];
  return [
    { label: 'مجموع المنتجات', amount: value.subtotal },
    ...(value.discount ? [{ label: 'الخصم', amount: -value.discount }] : []),
    { label: 'أجور التوصيل', amount: value.deliveryFee },
  ];
});
</script>

<template>
  <div>
    <v-btn variant="text" prepend-icon="mdi-arrow-right" class="mb-2 px-1" :to="{ name: 'orders' }">
      الطلبات
    </v-btn>

    <ErrorState
      v-if="error"
      :message="error.message"
      :correlation-id="error.correlationId"
      @retry="execute"
    />

    <v-skeleton-loader v-else-if="loading && !order" type="heading, card, card" />

    <template v-else-if="order">
      <PageHeader :title="`طلب #${order.orderNumber}`" :subtitle="subtitle">
        <template #actions>
          <v-chip :color="ORDER_STATUS_COLORS[order.status]" variant="flat">
            <v-icon :icon="ORDER_STATUS_ICONS[order.status]" start />
            {{ ORDER_STATUS_LABELS[order.status] }}
          </v-chip>

          <template v-if="canUpdate">
            <v-btn
              v-if="nextStatus"
              color="primary"
              :prepend-icon="ORDER_STATUS_ICONS[nextStatus]"
              @click="move(nextStatus)"
            >
              {{ ORDER_STATUS_ACTIONS[nextStatus] }}
            </v-btn>

            <v-menu v-if="laterStatuses.length || canCancel || canDelete" location="bottom end">
              <template #activator="{ props }">
                <v-btn v-bind="props" icon="mdi-dots-vertical" variant="tonal" aria-label="المزيد" />
              </template>
              <v-list density="compact">
                <v-list-item
                  v-for="status in laterStatuses"
                  :key="status"
                  :prepend-icon="ORDER_STATUS_ICONS[status]"
                  :title="`مباشرة إلى: ${ORDER_STATUS_LABELS[status]}`"
                  @click="move(status)"
                />
                <v-list-item
                  v-if="canCancel"
                  prepend-icon="mdi-close-circle-outline"
                  title="إلغاء الطلب"
                  base-color="error"
                  @click="move('CANCELLED')"
                />
                <v-list-item
                  v-if="canDelete && order.status === 'CANCELLED'"
                  prepend-icon="mdi-delete-outline"
                  title="حذف الطلب"
                  base-color="error"
                  @click="deleteOpen = true"
                />
              </v-list>
            </v-menu>
          </template>
        </template>
      </PageHeader>

      <v-alert
        v-if="order.status === 'CANCELLED'"
        type="error"
        variant="tonal"
        icon="mdi-close-circle-outline"
        class="mb-4"
      >
        أُلغي في {{ formatDateTime(order.cancelledAt) }}
        <template v-if="order.cancelReason">— {{ order.cancelReason }}</template>
      </v-alert>

      <v-row>
        <v-col cols="12" md="8">
          <v-card class="mb-4">
            <v-card-title class="d-flex align-center text-subtitle-1 font-weight-bold">
              المنتجات
              <v-spacer />
              <v-btn
                v-if="canUpdate && order.itemsEditable"
                size="small"
                variant="tonal"
                prepend-icon="mdi-pencil-outline"
                @click="itemsOpen = true"
              >
                تعديل
              </v-btn>
            </v-card-title>

            <v-table density="comfortable">
              <thead>
                <tr>
                  <th>المنتج</th>
                  <th class="text-center">الكمية</th>
                  <th class="text-end">السعر</th>
                  <th class="text-end">المجموع</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in order.items" :key="item.id">
                  <td>
                    <div class="d-flex align-center ga-3 py-2">
                      <v-avatar rounded="lg" size="40" color="surface-variant">
                        <v-img v-if="item.imageUrl" :src="item.imageUrl" cover />
                        <v-icon v-else icon="mdi-package-variant-closed" />
                      </v-avatar>
                      <div>
                        <div class="text-body-2 font-weight-medium">{{ item.productName }}</div>
                        <div class="text-caption text-medium-emphasis">
                          <span v-if="item.variantName">{{ item.variantName }} · </span>
                          <bdi dir="ltr">{{ item.sku }}</bdi>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td class="text-center numeric">{{ item.quantity }}</td>
                  <td class="text-end numeric">
                    {{ formatCurrency(item.unitPrice, order.currency) }}
                    <div v-if="item.discount" class="text-caption text-success">
                      خصم {{ formatCurrency(item.discount, order.currency) }}
                    </div>
                  </td>
                  <td class="text-end numeric font-weight-medium">
                    {{ formatCurrency(item.total, order.currency) }}
                  </td>
                </tr>
              </tbody>
            </v-table>

            <v-divider />

            <div class="pa-4">
              <div
                v-for="row in summaryRows"
                :key="row.label"
                class="d-flex justify-space-between text-body-2 mb-1"
              >
                <span class="text-medium-emphasis">{{ row.label }}</span>
                <span class="numeric">{{ formatCurrency(row.amount, order.currency) }}</span>
              </div>
              <div class="d-flex justify-space-between text-subtitle-1 font-weight-bold mt-2">
                <span>الإجمالي</span>
                <span class="numeric">{{ formatCurrency(order.total, order.currency) }}</span>
              </div>
            </div>
          </v-card>

          <v-card>
            <v-card-title class="text-subtitle-1 font-weight-bold">سجل الحالات</v-card-title>
            <v-timeline side="end" density="compact" align="start" class="px-4 pb-4" truncate-line="both">
              <v-timeline-item
                v-for="change in order.statusHistory"
                :key="change.id"
                :dot-color="ORDER_STATUS_COLORS[change.toStatus]"
                :icon="ORDER_STATUS_ICONS[change.toStatus]"
                size="small"
              >
                <div class="text-body-2 font-weight-medium">
                  {{ ORDER_STATUS_LABELS[change.toStatus] }}
                </div>
                <div class="text-caption text-medium-emphasis">
                  {{ formatDateTime(change.createdAt) }}
                  · {{ change.user?.fullName ?? (order.source === 'AI' ? 'المساعد الذكي' : 'النظام') }}
                </div>
                <div v-if="change.note" class="text-caption mt-1">{{ change.note }}</div>
              </v-timeline-item>
            </v-timeline>
          </v-card>
        </v-col>

        <v-col cols="12" md="4">
          <v-card class="mb-4">
            <v-card-title class="d-flex align-center text-subtitle-1 font-weight-bold">
              الدفع
              <v-spacer />
              <v-chip :color="PAYMENT_STATUS_COLORS[order.paymentStatus]" size="small" variant="tonal">
                {{ PAYMENT_STATUS_LABELS[order.paymentStatus] }}
              </v-chip>
            </v-card-title>
            <v-card-text>
              <div class="d-flex justify-space-between text-body-2 mb-1">
                <span class="text-medium-emphasis">الطريقة</span>
                <span>{{ PAYMENT_METHOD_LABELS[order.paymentMethod] }}</span>
              </div>
              <div class="d-flex justify-space-between text-body-2 mb-1">
                <span class="text-medium-emphasis">المستلم</span>
                <span class="numeric">{{ formatCurrency(order.paidAmount, order.currency) }}</span>
              </div>
              <div class="d-flex justify-space-between text-body-2 font-weight-bold">
                <span>المتبقي</span>
                <span class="numeric" :class="{ 'text-error': order.balanceDue > 0 }">
                  {{ formatCurrency(order.balanceDue, order.currency) }}
                </span>
              </div>
              <v-btn
                v-if="canUpdate && order.status !== 'CANCELLED'"
                block
                variant="tonal"
                color="primary"
                prepend-icon="mdi-cash-check"
                class="mt-4"
                @click="paymentOpen = true"
              >
                تسجيل الدفع
              </v-btn>
            </v-card-text>
          </v-card>

          <v-card class="mb-4">
            <v-card-title class="d-flex align-center text-subtitle-1 font-weight-bold">
              التوصيل
              <v-spacer />
              <v-btn
                v-if="canUpdate"
                size="small"
                variant="text"
                icon="mdi-pencil-outline"
                aria-label="تعديل"
                @click="detailsOpen = true"
              />
            </v-card-title>
            <v-list density="compact">
              <v-list-item prepend-icon="mdi-account-outline" :title="order.customerName" />
              <v-list-item prepend-icon="mdi-phone-outline">
                <v-list-item-title><bdi dir="ltr">{{ order.customerPhone }}</bdi></v-list-item-title>
              </v-list-item>
              <v-list-item
                prepend-icon="mdi-map-marker-outline"
                :title="[order.deliveryCity, order.deliveryAddress].filter(Boolean).join(' - ') || '—'"
              />
              <v-list-item
                prepend-icon="mdi-truck-outline"
                :title="ORDER_DELIVERY_STATUS_LABELS[order.deliveryStatus]"
              />
            </v-list>
            <v-card-text v-if="order.notes" class="pt-0">
              <v-alert density="compact" variant="tonal" icon="mdi-note-text-outline" class="notes">
                {{ order.notes }}
              </v-alert>
            </v-card-text>
          </v-card>

          <v-card>
            <v-card-title class="text-subtitle-1 font-weight-bold">الزبون</v-card-title>
            <v-list density="compact">
              <v-list-item
                prepend-icon="mdi-account-details-outline"
                :title="order.customer.name"
                :subtitle="order.customer.deleted ? 'زبون محذوف' : (order.customer.city ?? undefined)"
                :to="
                  canReadCustomers && !order.customer.deleted
                    ? { name: 'customer-detail', params: { id: order.customer.id } }
                    : undefined
                "
              />
              <v-list-item
                v-if="order.conversation"
                :prepend-icon="CHANNEL_ICONS[order.conversation.channel]"
                :title="`المحادثة على ${CHANNEL_LABELS[order.conversation.channel]}`"
                :disabled="!canReadConversations"
                :to="{ name: 'conversations', params: { id: order.conversation.id } }"
              />
            </v-list>
          </v-card>
        </v-col>
      </v-row>

      <OrderStatusDialog v-model="statusOpen" :order="order" :target="statusTarget" @saved="onSaved" />
      <OrderPaymentDialog v-model="paymentOpen" :order="order" @saved="onSaved" />
      <OrderDetailsDialog v-model="detailsOpen" :order="order" @saved="onSaved" />
      <OrderItemsDialog v-model="itemsOpen" :order="order" @saved="onSaved" />

      <ConfirmDialog
        v-model="deleteOpen"
        title="حذف الطلب"
        :message="`سيُحذف الطلب #${order.orderNumber} نهائياً. تبقى حركاته في سجل المخزون.`"
        confirm-label="حذف"
        :loading="deleting"
        @confirm="confirmDelete"
      />
    </template>
  </div>
</template>

<style scoped>
.notes {
  white-space: pre-line;
}
</style>
