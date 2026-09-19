export interface Tenant {
  id: string;
  name: string;
  plan: string;
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
