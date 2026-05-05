import "server-only";

export type Plan = "free" | "starter" | "pro" | "business" | "enterprise";

export interface PlanLimits {
  agents: number;
  flows: number;
  conversationsPerMonth: number;
  tokensPerMonth: number;
  members: number;
  knowledgeBases: number;
}

export const PLANS: Record<Plan, { name: string; priceUsd: number; limits: PlanLimits; stripePriceEnv?: string }> = {
  free: {
    name: "Free",
    priceUsd: 0,
    limits: {
      agents: 3,
      flows: 3,
      conversationsPerMonth: 100,
      tokensPerMonth: 50_000,
      members: 1,
      knowledgeBases: 1,
    },
  },
  starter: {
    name: "Starter",
    priceUsd: 29,
    limits: {
      agents: 10,
      flows: 10,
      conversationsPerMonth: 1_000,
      tokensPerMonth: 500_000,
      members: 3,
      knowledgeBases: 5,
    },
    stripePriceEnv: "STRIPE_PRICE_STARTER",
  },
  pro: {
    name: "Pro",
    priceUsd: 99,
    limits: {
      agents: 50,
      flows: 50,
      conversationsPerMonth: 10_000,
      tokensPerMonth: 5_000_000,
      members: 10,
      knowledgeBases: 25,
    },
    stripePriceEnv: "STRIPE_PRICE_PRO",
  },
  business: {
    name: "Business",
    priceUsd: 399,
    limits: {
      agents: Number.POSITIVE_INFINITY,
      flows: Number.POSITIVE_INFINITY,
      conversationsPerMonth: 100_000,
      tokensPerMonth: 50_000_000,
      members: 50,
      knowledgeBases: Number.POSITIVE_INFINITY,
    },
    stripePriceEnv: "STRIPE_PRICE_BUSINESS",
  },
  enterprise: {
    name: "Enterprise",
    priceUsd: 0, // custom
    limits: {
      agents: Number.POSITIVE_INFINITY,
      flows: Number.POSITIVE_INFINITY,
      conversationsPerMonth: Number.POSITIVE_INFINITY,
      tokensPerMonth: Number.POSITIVE_INFINITY,
      members: Number.POSITIVE_INFINITY,
      knowledgeBases: Number.POSITIVE_INFINITY,
    },
  },
};

export function planLimits(plan: Plan): PlanLimits {
  return PLANS[plan].limits;
}
