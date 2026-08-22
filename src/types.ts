// types.ts — shared domain types.

declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
      userId?: string;
    }
  }
}

export type LeadStatus = "new" | "replied" | "closed" | "won" | "lost";

export interface Lead {
  id: string;
  tenantId: string;
  siteId: string | null;
  name: string | null;
  contact: string;
  message: string | null;
  source: "form" | "chat_widget" | "whatsapp" | "missed_call";
  status: LeadStatus;
  score: number;
  customFields?: Record<string, unknown>;
  createdAt: string;
  lastActivityAt: string;
}

export interface Offer {
  id: string;
  tenantId: string;
  siteId: string | null;
  title: string;
  body: string | null;
  active: boolean;
  color?: string;
  displayMode?: string;
  styleVariant?: string;
  actionType?: string;
  promoCode?: string;
  targetUrl?: string;
  whatsappNumber?: string;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
}

export interface IngestLeadInput {
  siteKey: string;
  name?: string;
  contact: string;
  message?: string;
}

export interface Tenant {
  id: string;
  name: string;
  plan: string;
  createdAt: string;
}

export interface Site {
  id: string;
  tenantId: string;
  domain: string | null;
  apiKey: string;
  settings: Record<string, unknown>;
  createdAt: string;
}

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  role: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface SignupInput {
  businessName: string;
  email: string;
  password: string;
  servicesInfo?: string;
}

export type BlogPostStatus = "draft" | "published";

export interface BlogPost {
  id: string;
  tenantId: string;
  siteId: string | null;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  status: BlogPostStatus;
  aiGenerated: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BlogDraft {
  title: string;
  excerpt: string;
  content: string;
}
