import { Prisma } from '@prisma/client';
import { toLatinDigits } from '@common/utils/phone.util';

/**
 * Free-text customer match on name, email and phone. Phones are stored as +9647…, so a
 * search for "0770 123" is matched on its significant digits rather than as typed.
 */
export function customerSearchFilter(search: string): Prisma.CustomerWhereInput[] {
  const filters: Prisma.CustomerWhereInput[] = [
    { name: { contains: search, mode: 'insensitive' } },
    { email: { contains: search, mode: 'insensitive' } },
  ];

  const digits = toLatinDigits(search).replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length >= 3) {
    filters.push({ phone: { contains: digits } }, { altPhone: { contains: digits } });
  }

  return filters;
}
