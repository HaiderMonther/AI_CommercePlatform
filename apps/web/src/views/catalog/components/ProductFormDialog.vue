<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useFormSubmit } from '@/composables/useFormSubmit';
import { rules } from '@/composables/useValidation';
import { productsService } from '@/services/catalog.service';
import { useAuthStore } from '@/stores/auth.store';
import { formatCurrency } from '@/utils/format';
import type { Category, Product } from '@/types/users';

const props = defineProps<{
  modelValue: boolean;
  product: Product | null;
  categories: Category[];
}>();

const emit = defineEmits<{ 'update:modelValue': [value: boolean]; saved: [] }>();

const auth = useAuthStore();
const { submitting, errorMessage, fieldErrors, submit } = useFormSubmit();

const formRef = ref();
const imageUrl = ref('');

const form = ref({
  name: '',
  sku: '',
  description: '',
  price: null as number | null,
  salePrice: null as number | null,
  costPrice: null as number | null,
  categoryId: null as string | null,
  initialStock: 0,
  lowStockThreshold: 5,
  trackInventory: true,
  isActive: true,
  tags: [] as string[],
  images: [] as { url: string; isPrimary?: boolean }[],
});

const isEdit = computed(() => Boolean(props.product));

const categoryOptions = computed(() =>
  props.categories.map((category) => ({
    value: category.id,
    title: category.parentId ? `— ${category.name}` : category.name,
  })),
);

/** Margin is the number a merchant actually decides pricing on, so it is shown live. */
const margin = computed(() => {
  const sell = form.value.salePrice ?? form.value.price;
  const cost = form.value.costPrice;
  if (!sell || !cost || cost <= 0) return null;
  return { amount: sell - cost, percent: Math.round(((sell - cost) / sell) * 100) };
});

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;

    errorMessage.value = null;
    fieldErrors.value = [];
    imageUrl.value = '';

    form.value = props.product
      ? {
          name: props.product.name,
          sku: props.product.sku,
          description: props.product.description ?? '',
          price: props.product.price,
          salePrice: props.product.salePrice,
          costPrice: props.product.costPrice,
          categoryId: props.product.categoryId,
          initialStock: 0,
          lowStockThreshold: props.product.lowStockThreshold,
          trackInventory: props.product.trackInventory,
          isActive: props.product.isActive,
          tags: [...props.product.tags],
          images: props.product.images.map((image) => ({
            url: image.url,
            isPrimary: image.isPrimary,
          })),
        }
      : {
          name: '',
          sku: '',
          description: '',
          price: null,
          salePrice: null,
          costPrice: null,
          categoryId: null,
          initialStock: 0,
          lowStockThreshold: 5,
          trackInventory: true,
          isActive: true,
          tags: [],
          images: [],
        };
  },
);

function addImage(): void {
  const url = imageUrl.value.trim();
  if (!url) return;

  form.value.images.push({ url, isPrimary: form.value.images.length === 0 });
  imageUrl.value = '';
}

function removeImage(index: number): void {
  form.value.images.splice(index, 1);
  if (form.value.images.length > 0 && !form.value.images.some((image) => image.isPrimary)) {
    form.value.images[0].isPrimary = true;
  }
}

function setPrimary(index: number): void {
  form.value.images = form.value.images.map((image, position) => ({
    ...image,
    isPrimary: position === index,
  }));
}

async function onSubmit(): Promise<void> {
  const { valid } = await formRef.value.validate();
  if (!valid) return;

  const payload = {
    name: form.value.name,
    description: form.value.description || undefined,
    price: Number(form.value.price),
    salePrice: form.value.salePrice ? Number(form.value.salePrice) : undefined,
    costPrice: form.value.costPrice ? Number(form.value.costPrice) : undefined,
    categoryId: form.value.categoryId ?? undefined,
    lowStockThreshold: form.value.lowStockThreshold,
    trackInventory: form.value.trackInventory,
    isActive: form.value.isActive,
    tags: form.value.tags,
    images: form.value.images,
    ...(form.value.sku ? { sku: form.value.sku } : {}),
    // Only meaningful on create; stock afterwards moves through the inventory ledger.
    ...(!isEdit.value && form.value.initialStock ? { initialStock: form.value.initialStock } : {}),
  };

  await submit(
    () =>
      props.product
        ? productsService.update(props.product.id, payload)
        : productsService.create(payload),
    {
      successMessage: props.product ? 'تم تحديث المنتج' : 'تم إنشاء المنتج',
      onSuccess: () => {
        emit('saved');
        emit('update:modelValue', false);
      },
    },
  );
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="780"
    scrollable
    persistent
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-subtitle-1 font-weight-bold pt-4">
        {{ isEdit ? 'تعديل المنتج' : 'منتج جديد' }}
      </v-card-title>

      <v-divider />

      <v-card-text style="max-height: 70vh">
        <v-alert v-if="errorMessage" type="error" density="comfortable" class="mb-4">
          {{ errorMessage }}
          <ul v-if="fieldErrors.length" class="mt-2 ps-4 text-caption">
            <li v-for="detail in fieldErrors" :key="detail">{{ detail }}</li>
          </ul>
        </v-alert>

        <v-form ref="formRef">
          <v-row dense>
            <v-col cols="12" md="8">
              <v-text-field
                v-model="form.name"
                label="اسم المنتج"
                :rules="[rules.required(), rules.minLength(2)]"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field
                v-model="form.sku"
                label="رمز المنتج (SKU)"
                dir="ltr"
                :hint="isEdit ? undefined : 'يُولَّد تلقائياً إن تُرك فارغاً'"
                :persistent-hint="!isEdit"
              />
            </v-col>

            <v-col cols="12">
              <v-textarea
                v-model="form.description"
                label="الوصف"
                rows="2"
                auto-grow
                hint="يستخدمه المساعد الذكي للرد على أسئلة الزبائن"
                persistent-hint
              />
            </v-col>

            <v-col cols="12" md="4">
              <v-text-field
                v-model.number="form.price"
                label="سعر البيع"
                type="number"
                min="0"
                :suffix="auth.currency === 'IQD' ? 'د.ع' : auth.currency"
                :rules="[rules.required('السعر مطلوب')]"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field
                v-model.number="form.salePrice"
                label="سعر بعد الخصم"
                type="number"
                min="0"
                :suffix="auth.currency === 'IQD' ? 'د.ع' : auth.currency"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field
                v-model.number="form.costPrice"
                label="سعر التكلفة"
                type="number"
                min="0"
                :suffix="auth.currency === 'IQD' ? 'د.ع' : auth.currency"
                hint="لا يظهر للزبون"
                persistent-hint
              />
            </v-col>

            <v-col v-if="margin" cols="12">
              <v-alert type="info" density="compact" variant="tonal">
                هامش الربح:
                <strong>{{ formatCurrency(margin.amount, auth.currency) }}</strong>
                (<span class="numeric">{{ margin.percent }}%</span>)
              </v-alert>
            </v-col>

            <v-col cols="12" md="6">
              <v-select
                v-model="form.categoryId"
                :items="categoryOptions"
                label="التصنيف"
                clearable
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-combobox
                v-model="form.tags"
                label="الوسوم"
                multiple
                chips
                closable-chips
                hide-details="auto"
                variant="outlined"
                density="comfortable"
              />
            </v-col>

            <v-col cols="12">
              <v-divider class="my-2" />
              <div class="text-subtitle-2 font-weight-bold mb-2">المخزون</div>
            </v-col>

            <v-col cols="12" md="4">
              <v-switch
                v-model="form.trackInventory"
                label="تتبّع المخزون"
                color="primary"
                hide-details
                density="comfortable"
              />
            </v-col>
            <v-col v-if="!isEdit && form.trackInventory" cols="12" md="4">
              <v-text-field
                v-model.number="form.initialStock"
                label="الكمية الابتدائية"
                type="number"
                min="0"
              />
            </v-col>
            <v-col v-if="form.trackInventory" cols="12" md="4">
              <v-text-field
                v-model.number="form.lowStockThreshold"
                label="حد التنبيه"
                type="number"
                min="0"
              />
            </v-col>

            <v-col v-if="isEdit && product?.trackInventory" cols="12">
              <v-alert type="info" density="compact" variant="tonal">
                الكمية الحالية
                <strong class="numeric">{{ product?.stock }}</strong>
                — لتغييرها استخدم «تعديل المخزون» ليُسجَّل السبب في سجل الحركات.
              </v-alert>
            </v-col>

            <v-col cols="12">
              <v-divider class="my-2" />
              <div class="text-subtitle-2 font-weight-bold mb-2">الصور</div>
            </v-col>

            <v-col cols="12">
              <div class="d-flex ga-2">
                <v-text-field
                  v-model="imageUrl"
                  label="رابط الصورة"
                  dir="ltr"
                  placeholder="https://..."
                  @keyup.enter="addImage"
                />
                <v-btn variant="tonal" :disabled="!imageUrl.trim()" @click="addImage">إضافة</v-btn>
              </div>

              <div v-if="form.images.length" class="d-flex flex-wrap ga-2 mt-3">
                <v-card
                  v-for="(image, index) in form.images"
                  :key="`${image.url}-${index}`"
                  width="88"
                  class="position-relative"
                >
                  <v-img :src="image.url" height="88" cover />
                  <v-chip
                    v-if="image.isPrimary"
                    size="x-small"
                    color="primary"
                    class="position-absolute"
                    style="top: 4px; inset-inline-start: 4px"
                  >
                    رئيسية
                  </v-chip>
                  <div class="d-flex justify-space-between">
                    <v-btn
                      icon="mdi-star-outline"
                      size="x-small"
                      variant="text"
                      title="جعلها رئيسية"
                      @click="setPrimary(index)"
                    />
                    <v-btn
                      icon="mdi-close"
                      size="x-small"
                      variant="text"
                      color="error"
                      @click="removeImage(index)"
                    />
                  </div>
                </v-card>
              </div>
            </v-col>

            <v-col cols="12">
              <v-switch
                v-model="form.isActive"
                label="المنتج مفعّل ويظهر للمساعد الذكي"
                color="primary"
                hide-details
                density="comfortable"
              />
            </v-col>
          </v-row>
        </v-form>
      </v-card-text>

      <v-divider />

      <v-card-actions class="px-4 py-3">
        <v-spacer />
        <v-btn variant="text" :disabled="submitting" @click="$emit('update:modelValue', false)">
          إلغاء
        </v-btn>
        <v-btn color="primary" :loading="submitting" @click="onSubmit">حفظ</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
