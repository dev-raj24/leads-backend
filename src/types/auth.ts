export interface Tenant {
  id: string;
  name: string;
  plan: string;
  industry: string | null;
  onboardingCompleted: boolean;
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

export const PLANS = ["free", "pro"] as const;
export type Plan = (typeof PLANS)[number];
