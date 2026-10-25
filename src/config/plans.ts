import type { Plan } from "../types";

export interface PlanDef {
  id: Plan;
  name: string;
  priceInr: number;
  leadsPerMonth: number;
  aiChatMessagesPerMonth: number;
  features: {
    aiReply: boolean;
    chatWidget: boolean;
    offers: boolean;
    blog: boolean;
    autoFollowup: boolean;
  };
}

export const PLAN_DEFS: Record<Plan, PlanDef> = {
  free: {
    id: "free",
    name: "Free",
    priceInr: 0,
    leadsPerMonth: 50,
    aiChatMessagesPerMonth: 0,
    features: { aiReply: false, chatWidget: false, offers: false, blog: false, autoFollowup: false },
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceInr: 999,
    leadsPerMonth: 1000,
    aiChatMessagesPerMonth: 2000,
    features: { aiReply: true, chatWidget: true, offers: true, blog: true, autoFollowup: true },
  },
};

export const planDef = (plan: string): PlanDef => PLAN_DEFS[plan === "pro" ? "pro" : "free"];
