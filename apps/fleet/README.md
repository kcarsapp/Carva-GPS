# Carva Fleet

Marketing site + Fleet Dashboard MVP for an AI fleet-management / vehicle-tracking SaaS.

Built with **Next.js 14 (App Router)**, **TypeScript**, **Tailwind CSS**, and **Shadcn/UI**.
Runs entirely on mock data — no backend, database, or GPS hardware required.

## Run it

From the monorepo root:

```bash
npm install        # installs all workspaces
npm run fleet      # starts this app on http://localhost:3001
```

Or from this directory:

```bash
npm run dev        # http://localhost:3001
```

> The existing `@carva/web` (Traccar) app runs on port 3000; this app uses 3001 so both can run side by side.

## What's inside

### Marketing site
- `/` — Hero with dashboard preview, Features grid, interactive Live Demo map, Pricing, CTA
- `/pricing` — Tiered pricing matrix with monthly/annual toggle + FAQ

### Dashboard MVP (`/dashboard`)
- Responsive sidebar layout (Dashboard, Vehicles, Drivers, Alerts, Settings)
- Metrics bar (active vehicles, fuel used, safety score, active alerts)
- Filterable + searchable vehicle table with status badges and fuel/battery bars

## Structure

```
app/
  (marketing)/        # public site (Navbar + Footer layout)
    page.tsx          # home
    pricing/page.tsx
  dashboard/          # app shell (sidebar layout)
    page.tsx          # overview
    vehicles/ drivers/ alerts/ settings/
components/
  ui/                 # Shadcn primitives (button, card, badge, table, switch…)
  marketing/          # hero, features, live-demo, pricing, navbar, footer, cta
  dashboard/          # sidebar, metric-card, vehicle-table, status-badge…
lib/                  # cn() util + status display helpers
mock/                 # ← all sample data lives here (typed)
  types.ts vehicles.ts drivers.ts alerts.ts metrics.ts index.ts
```

## Adding more Shadcn components

`components.json` is configured, so you can pull in additional components:

```bash
npx shadcn@latest add dialog dropdown-menu
```

## Wiring up a real backend

Replace the imports from `@/mock` with API/DB calls. Every component consumes the
typed interfaces in `mock/types.ts`, so as long as your data matches those shapes,
the UI works unchanged.
