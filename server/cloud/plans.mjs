import { z } from "zod";

// Central, authoritative subscription plan configuration.
// Prices are integer minor units (paise) in INR and are enforced by the
// backend on every purchase. Durations are exact seconds in UTC.
// The service operator may override the catalog with PLANS_JSON; overrides
// are validated and never trusted from any browser request. Adding a plan
// is a configuration change only — no application logic changes.
const planSchema = z.object({
  id: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  label: z.string().trim().min(1).max(60),
  priceMinor: z.number().int().min(100).max(100000000),
  currency: z.literal("INR"),
  durationSeconds: z.number().int().min(3600).max(31536000),
  durationLabel: z.string().trim().min(1).max(80),
  taxNote: z.string().trim().min(1).max(120),
  highlight: z.boolean().optional(),
});

export const DEFAULT_PLANS = [
  {
    id: "hourly",
    label: "Hourly",
    priceMinor: 10000, // ₹100.00
    currency: "INR",
    durationSeconds: 3600, // exactly 1 hour
    durationLabel: "1 hour",
    taxNote: "Inclusive of applicable taxes.",
  },
  {
    id: "daily",
    label: "Daily",
    priceMinor: 20000, // ₹200.00
    currency: "INR",
    durationSeconds: 86400, // exactly 24 hours
    durationLabel: "24 hours",
    taxNote: "Inclusive of applicable taxes.",
  },
  {
    id: "ten-day",
    label: "10-Day",
    priceMinor: 100000, // ₹1,000.00
    currency: "INR",
    durationSeconds: 864000, // exactly 10 × 24 hours
    durationLabel: "10 days",
    taxNote: "Inclusive of applicable taxes.",
    highlight: true,
  },
  {
    id: "monthly",
    label: "Monthly",
    priceMinor: 150000, // ₹1,500.00
    currency: "INR",
    durationSeconds: 2592000, // exactly 30 × 24 hours
    durationLabel: "30 Days / 1 Month",
    taxNote: "Inclusive of applicable taxes.",
  },
];

function parsePlan(value, index) {
  const parsed = planSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      `Plan entry ${index} is invalid: ${parsed.error.issues
        .map((i) => i.path.join(".") + " " + i.message)
        .join("; ")}`,
    );
  return parsed.data;
}

export function loadPlans(env = process.env, taxNote) {
  let source = DEFAULT_PLANS;
  if (env.PLANS_JSON) {
    let parsed;
    try {
      parsed = JSON.parse(env.PLANS_JSON);
    } catch {
      throw new Error("PLANS_JSON must contain a JSON array of plans.");
    }
    if (!Array.isArray(parsed) || parsed.length === 0)
      throw new Error("PLANS_JSON must be a non-empty array of plans.");
    source = parsed;
  }
  const defaultTax = taxNote ?? env.PLAN_TAX_NOTE;
  const plans = source.map((value, index) => {
    const plan = parsePlan(value, index);
    return { ...plan, taxNote: defaultTax ? String(defaultTax) : plan.taxNote };
  });
  const byId = new Map(plans.map((plan) => [plan.id, plan]));
  if (byId.size !== plans.length) throw new Error("Plan ids must be unique.");
  return {
    plans,
    byId,
    get: (id) => byId.get(String(id || "").toLowerCase()) || null,
    public() {
      return plans.map((plan) => ({
        id: plan.id,
        label: plan.label,
        priceMinor: plan.priceMinor,
        currency: plan.currency,
        durationSeconds: plan.durationSeconds,
        durationLabel: plan.durationLabel,
        taxNote: plan.taxNote,
        highlight: Boolean(plan.highlight),
      }));
    },
  };
}

export function formatINR(priceMinor) {
  const amount = priceMinor / 100;
  return "₹" + amount.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
