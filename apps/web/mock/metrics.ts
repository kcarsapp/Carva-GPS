import type { FleetMetric, PricingTier } from "./types";
import { vehicles } from "./vehicles";
import { drivers } from "./drivers";
import { unacknowledgedAlerts } from "./alerts";

const activeVehicles = vehicles.filter(
  (v) => v.status === "in_transit" || v.status === "idle",
).length;

const avgSafety = Math.round(
  drivers.reduce((sum, d) => sum + d.safetyScore, 0) / drivers.length,
);

export const fleetMetrics: FleetMetric[] = [
  {
    id: "active",
    label: "Active vehicles",
    value: `${activeVehicles} / ${vehicles.length}`,
    delta: 4.2,
    positiveIsGood: true,
  },
  {
    id: "fuel",
    label: "Fuel used (7d)",
    value: "3,914 L",
    delta: -6.8,
    positiveIsGood: false,
  },
  {
    id: "safety",
    label: "Avg. safety score",
    value: `${avgSafety}`,
    delta: 2.1,
    positiveIsGood: true,
  },
  {
    id: "alerts",
    label: "Active alerts",
    value: `${unacknowledgedAlerts.length}`,
    delta: -1,
    positiveIsGood: false,
  },
];

export const pricingTiers: PricingTier[] = [
  {
    id: "starter",
    name: "Starter",
    description: "For small fleets getting off spreadsheets.",
    monthly: 24,
    annual: 19,
    highlighted: false,
    cta: "Start free trial",
    features: [
      "Up to 10 vehicles",
      "Real-time GPS tracking",
      "Trip history (30 days)",
      "Email alerts",
      "Mobile app access",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    description: "For growing operations that need AI insight.",
    monthly: 49,
    annual: 39,
    highlighted: true,
    cta: "Start free trial",
    features: [
      "Up to 100 vehicles",
      "AI dashcams & safety scoring",
      "Automated maintenance scheduling",
      "Fuel & route optimization",
      "Geofencing + custom alerts",
      "Trip history (1 year)",
      "Priority support",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description: "For large fleets with custom requirements.",
    monthly: 0,
    annual: 0,
    highlighted: false,
    cta: "Contact sales",
    features: [
      "Unlimited vehicles",
      "Dedicated success manager",
      "Custom integrations & API",
      "SSO / SAML & audit logs",
      "SLA-backed uptime",
      "On-site onboarding",
    ],
  },
];
