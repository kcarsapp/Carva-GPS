import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Hero } from "@/components/marketing/hero";
import { Features } from "@/components/marketing/features";
import { LiveDemo } from "@/components/marketing/live-demo";
import { Pricing } from "@/components/marketing/pricing";
import { CtaBanner } from "@/components/marketing/cta";

export default function HomePage() {
  return (
    <>
      <Hero />
      <Features />

      <section id="demo" className="border-t py-20">
        <div className="container grid items-center gap-12 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Watch your fleet move in real time
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              This is a live, interactive preview. Three vehicles broadcasting
              their position, speed, and operational status — exactly how it
              feels inside Carva Fleet.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <strong className="text-foreground">In Transit</strong> — moving,
                live telematics streaming
              </li>
              <li className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                <strong className="text-foreground">Idle</strong> — parked with
                engine on
              </li>
              <li className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                <strong className="text-foreground">Maintenance Required</strong>{" "}
                — flagged for service
              </li>
            </ul>
            <Button className="mt-7" asChild>
              <Link href="/fleet">
                Explore the demo dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>

          <LiveDemo />
        </div>
      </section>

      <div className="border-t bg-muted/20">
        <Pricing />
      </div>

      <CtaBanner />
    </>
  );
}
