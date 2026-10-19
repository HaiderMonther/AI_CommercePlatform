/** Contracts of the Phase 8 API: plans, subscriptions, invoices and the platform team. */

export type PlanTier = 'BASIC' | 'BUSINESS' | 'ENTERPRISE';
export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED';
export type Standing = 'active' | 'grace' | 'restricted';
export type InvoiceStatus = 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE';
export type LimitMetric = 'USERS' | 'PRODUCTS' | 'CHANNELS' | 'AI_MESSAGES';
export type CompanyStatus = 'ACTIVE' | 'SUSPENDED' | 'TRIAL' | 'CANCELLED';

export interface Plan {
  id: string;
  tier: PlanTier;
  name: string;
  nameAr: string;
  priceMonthly: number;
  currency: string;
  /** -1 or missing means unlimited. */
  limits: Partial<Record<LimitMetric, number>>;
  features: string[];
}

export interface BillingStatus {
  status: SubscriptionStatus | null;
  standing: Standing;
  tier: PlanTier | null;
  periodEnd: string | null;
  daysLeft: number | null;
  openInvoice: { number: string; total: number; currency: string; dueAt: string | null } | null;
}

export interface UsageRow {
  metric: LimitMetric;
  label: string;
  used: number;
  /** null = unlimited */
  limit: number | null;
  perPeriod?: boolean;
}

export interface BillingOverview {
  subscription: {
    id: string;
    status: SubscriptionStatus;
    standing: Standing;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    cancelledAt: string | null;
    plan: Plan;
  } | null;
  usage: UsageRow[];
  plans: Plan[];
}

export interface Invoice {
  id: string;
  number: string;
  status: InvoiceStatus;
  currency: string;
  subtotal: number;
  total: number;
  periodStart: string;
  periodEnd: string;
  dueAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface PlatformCompanyRow {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  status: CompanyStatus;
  planTier: PlanTier;
  createdAt: string;
  counts: { users: number; orders: number; products: number };
  subscription: {
    status: SubscriptionStatus;
    standing: Standing;
    currentPeriodEnd: string;
    plan: { tier: PlanTier };
  } | null;
  openInvoices: number;
  amountDue: number;
}

export interface PlatformCompany {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  status: CompanyStatus;
  planTier: PlanTier;
  trialEndsAt: string | null;
  createdAt: string;
  subscription: {
    id: string;
    status: SubscriptionStatus;
    standing: Standing;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    plan: { tier: PlanTier; nameAr: string };
  } | null;
  usage: UsageRow[];
  invoices: Invoice[];
}
