# Carva GPS — Roadmap

## Vision
A modern, easy-to-use GPS tracking app (web + iOS + Android) that works for many user types and connects to any GPS hardware.

### Account types
- **Personal** — track my own car / family / pet tag.
- **Car rental** — fleet of rental vehicles, assign to renters, contracts, mileage.
- **School bus** — routes, students, parent live-view, pickup/dropoff alerts.
- **Logistics** — fleet, drivers, dispatch, trip/route optimization, reports.

### Hardware support
- Any standard GPS tracker via **Traccar** (~200 protocols): GT06/Concox, TK103/GPS103, Coban, Teltonika, H02, etc.
- BLE tags (our own / standard).
- AirTags: **not officially possible** (closed Find My network) — exploratory only.

---

## Phase 1 — Foundation
- [x] Monorepo (web, mobile, api, shared, ui)
- [x] Web app shell runnable
- [ ] Mobile app shell runnable
- [ ] API shell runnable
- [ ] Design system / tokens

## Phase 2 — Core tracking
- [x] Traccar REST client (+ WebSocket client in `@carva/shared`)
- [ ] Auth / login
- [x] Device list
- [x] Live map with real-time moving markers (web)
- [ ] Live map on mobile

## Phase 3 — Multi-user
- [ ] Account types & roles
- [ ] Sub-users & permissions
- [ ] Per-tenant device groups

## Phase 4 — Features
- [ ] Trip history & replay
- [ ] Geofences
- [ ] Alerts & push notifications
- [ ] Reports & exports
- [ ] Location sharing links

## Phase 5 — Hardware & launch
- [ ] "Add a tracker" onboarding (any device)
- [ ] BLE tag support
- [ ] App Store + Play Store submission
- [ ] Web deployment

---

## Tech decisions
| Concern | Choice |
|---|---|
| Ingestion | Traccar (self-hosted, Dockerized) |
| Backend | NestJS + PostgreSQL |
| Web | Next.js (App Router) |
| Mobile | Expo / React Native |
| Maps | MapLibre GL (+ Mapbox tiles option) |
| Shared code | TypeScript package `@carva/shared` |
| Auth | JWT (Carva API), proxying Traccar sessions |

## Open questions (revisit later)
- Hosting: where to run Traccar + API + Postgres (VPS vs managed)?
- Map tiles provider + budget (MapLibre/OSM free vs Mapbox/Google paid).
- Billing model per account type (subscription per device?).
