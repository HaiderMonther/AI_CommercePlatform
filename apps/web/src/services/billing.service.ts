import { http, unwrap } from './http';
import { cleanParams } from './users.service';
import type { Paginated } from '@/types/api';
import type {
  BillingOverview,
  BillingStatus,
  CompanyStatus,
  Invoice,
  InvoiceStatus,
  PlanTier,
  PlatformCompany,
  PlatformCompanyRow,
} from '@/types/billing';

export const billingService = {
  status: () => unwrap<BillingStatus>(http.get('/billing/status')),
  overview: () => unwrap<BillingOverview>(http.get('/billing/subscription')),
  invoices: () => unwrap<Invoice[]>(http.get('/billing/invoices')),
  changePlan: (tier: PlanTier) =>
    unwrap<BillingOverview>(http.post('/billing/subscription/change', { tier })),
  setCancel: (cancel: boolean) =>
    unwrap<BillingOverview>(http.post('/billing/subscription/cancel', { cancel })),
};

export const platformService = {
  companies: (params: { page?: number; limit?: number; search?: string; status?: CompanyStatus }) =>
    unwrap<Paginated<PlatformCompanyRow>>(
      http.get('/platform/companies', { params: cleanParams(params) }),
    ),
  company: (id: string) => unwrap<PlatformCompany>(http.get(`/platform/companies/${id}`)),
  setStatus: (id: string, status: 'ACTIVE' | 'SUSPENDED') =>
    unwrap<PlatformCompany>(http.patch(`/platform/companies/${id}/status`, { status })),
  updateSubscription: (id: string, payload: { tier?: PlanTier; extendDays?: number }) =>
    unwrap<PlatformCompany>(http.patch(`/platform/companies/${id}/subscription`, payload)),
  invoices: (params: { page?: number; limit?: number; status?: InvoiceStatus }) =>
    unwrap<Paginated<Invoice & { company: { id: string; name: string } }>>(
      http.get('/platform/invoices', { params: cleanParams(params) }),
    ),
  markPaid: (id: string) => unwrap<PlatformCompany>(http.post(`/platform/invoices/${id}/pay`)),
  voidInvoice: (id: string) => unwrap<PlatformCompany>(http.post(`/platform/invoices/${id}/void`)),
};
