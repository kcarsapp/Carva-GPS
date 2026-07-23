import Link from "next/link";
import { ArrowRight, PlayCircle, Activity, ShieldCheck, Fuel } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const miniBars = [42, 58, 47, 65, 71, 60, 78, 84, 72, 90];

function DashboardPreview() {
  return (
    <div className="relative">
      {/* glow */}
      <div className="absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-tr from-primary/20 via-primary/5 to-emerald-400/20 blur-2xl" />

      <div className="overflow-hidden rounded-2xl border bg-card shadow-2xl">
        {/* window chrome */}
        <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-3">
          <span className="h-3 w-3 rounded-full bg-red-400" />
          <span className="h-3 w-3 rounded-full bg-amber-400" />
          <span className="h-3 w-3 rounded-full bg-emerald-400" />
          <span className="ml-3 text-xs text-muted-foreground">
            app.carvafleet.com/dashboard
          </span>
        </div>

        <div className="space-y-4 p-4">
          {/* metric chips */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: Activity, label: "Active", value: "6/8", tone: "text-emerald-500" },
              { icon: ShieldCheck, label: "Safety", value: "87", tone: "text-sky-500" },
              { icon: Fuel, label: "Fuel −7%", value: "3.9k L", tone: "text-amber-500" },
            ].map((m) => (
              <div key={m.label} className="rounded-xl border bg-background p-3">
                <m.icon className={`h-4 w-4 ${m.tone}`} />
                <p className="mt-2 text-lg font-bold leading-none">{m.value}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{m.label}</p>
              </div>
            ))}
          </div>

          {/* chart + status */}
          <div className="grid grid-cols-5 gap-3">
            <div className="col-span-3 rounded-xl border bg-background p-3">
              <p className="text-[11px] font-medium text-muted-foreground">
                Distance driven (7d)
              </p>
              <div className="mt-3 flex h-24 items-end gap-1.5">
                {miniBars.map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t bg-primary/80"
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
            </div>
            <div className="col-span-2 space-y-2 rounded-xl border bg-background p-3">
              <p className="text-[11px] font-medium text-muted-foreground">
                Fleet status
              </p>
              {[
                { c: "bg-emerald-500", l: "In transit", n: 4 },
                { c: "bg-amber-500", l: "Idle", n: 2 },
                { c: "bg-red-500", l: "Maintenance", n: 1 },
                { c: "bg-slate-400", l: "Offline", n: 1 },
              ].map((s) => (
                <div key={s.l} className="flex items-center gap-2 text-xs">
                  <span className={`h-2 w-2 rounded-full ${s.c}`} />
                  <span className="text-muted-foreground">{s.l}</span>
                  <span className="ml-auto font-semibold">{s.n}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* floating alert card */}
      <div className="absolute -bottom-5 -left-5 hidden rounded-xl border bg-card p-3 shadow-xl sm:block">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 text-red-500">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div>
            <p className="text-xs font-semibold">AI safety event</p>
            <p className="text-[11px] text-muted-foreground">
              Harsh braking · Truck 014
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-grid">
      <div className="absolute inset-x-0 top-0 -z-10 h-[480px] bg-gradient-to-b from-primary/5 to-transparent" />
      <div className="container grid items-center gap-12 py-16 md:grid-cols-2 md:py-24">
        <div>
          <Badge variant="secondary" className="mb-5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            New · AI dashcam safety scoring
          </Badge>
          <h1 className="text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
            Real-time{" "}
            <span className="bg-gradient-to-r from-primary to-emerald-500 bg-clip-text text-transparent">
              AI fleet tracking
            </span>{" "}
            for modern operations
          </h1>
          <p className="mt-5 max-w-lg text-lg text-muted-foreground">
            Track every vehicle live, catch safety risks before they happen, and
            cut fuel costs — all from one dashboard. No hardware tokens required
            to explore.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button size="lg" asChild>
              <Link href="/dashboard">
                Start free trial
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/#demo">
                <PlayCircle className="h-4 w-4" />
                See live demo
              </Link>
            </Button>
          </div>
          <p className="mt-5 text-sm text-muted-foreground">
            14-day free trial · No credit card · Cancel anytime
          </p>
        </div>

        <DashboardPreview />
      </div>
    </section>
  );
}
