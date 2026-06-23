# Carva GPS

Modern, multi-tenant GPS tracking platform — **web + iOS + Android** from one codebase.

Built to connect any GPS hardware tracker (GT06/Concox, TK103/GPS103, Coban, Teltonika, H02, and ~200 more) via a [Traccar](https://www.traccar.org/) ingestion engine, with a clean custom UI and account types for **personal, car rental, school bus, and logistics** users.

## Architecture

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│  GPS Tracker│   │  GPS Tracker│   │  BLE / tag  │
└──────┬──────┘   └──────┬──────┘   └──────┬──────┘
       │ TCP/UDP (device protocols)        │ BLE
       ▼                                    ▼
┌───────────────────────────┐     ┌──────────────────┐
│   Traccar (ingestion)     │     │  Mobile (gateway)│
│   200+ protocols, REST/WS │     └──────────────────┘
└─────────────┬─────────────┘
              │ REST + WebSocket
              ▼
┌───────────────────────────────────────────────────┐
│   @carva/api  (NestJS)                             │
│   multi-tenant users/roles, billing, alerts        │
└─────────────┬─────────────────────────┬────────────┘
              │ REST/WS                  │
              ▼                          ▼
     ┌─────────────────┐       ┌──────────────────┐
     │  @carva/web     │       │  @carva/mobile   │
     │  Next.js        │       │  Expo / RN       │
     └─────────────────┘       └──────────────────┘
```

## Workspaces

| Package | Description |
|---|---|
| `packages/shared` | Shared TypeScript types + API client (Traccar + Carva API) |
| `packages/ui` | Shared design tokens / UI primitives |
| `apps/web` | Next.js website + web dashboard |
| `apps/mobile` | Expo React Native app (iOS + Android) |
| `apps/api` | NestJS backend (multi-tenant, auth, alerts) |

## Getting started

```bash
npm install          # install all workspaces
npm run web          # start the website (http://localhost:3000)
```

See `docs/` for the full plan and per-app setup.

## Status

Phase 1 — foundation (in progress). See roadmap in `docs/ROADMAP.md`.

## Note on AirTags

Apple AirTags use the closed Find My network with **no public API**, so they cannot be officially integrated. Carva supports standard GPS and BLE trackers; AirTag support is exploratory only.
