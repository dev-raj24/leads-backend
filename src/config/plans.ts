import type { Plan } from "../types";

export interface PlanDef {
  id: Plan;
  name: string;
  priceInr: number;
  leadsPerMonth: number;
  features: {
    aiReply: boolean;
    autoFollowup: boolean;
  };
}

export const PLAN_DEFS: Record<Plan, PlanDef> = {
  free: {
    id: "free",
    name: "Free",
    priceInr: 0,
    leadsPerMonth: 50,
    features: { aiReply: false, autoFollowup: false },
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceInr: 999,
    leadsPerMonth: 1000,
    features: { aiReply: true, autoFollowup: true },
  },
};

export const planDef = (plan: string): PlanDef => PLAN_DEFS[plan === "pro" ? "pro" : "free"];
