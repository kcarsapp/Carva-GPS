import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export function CtaBanner() {
  return (
    <section className="py-20">
      <div className="container">
        <div className="relative overflow-hidden rounded-3xl bg-primary px-6 py-14 text-center text-primary-foreground sm:px-12">
          <div className="absolute inset-0 -z-0 opacity-20 [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:22px_22px]" />
          <div className="relative">
            <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
              Ready to put your fleet on autopilot?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-primary-foreground/80">
              Join operations teams cutting costs and accidents with Carva Fleet.
              Spin up a workspace in minutes.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Button size="lg" variant="secondary" asChild>
                <Link href="/dashboard">
                  Open the dashboard
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
                asChild
              >
                <Link href="/pricing">View pricing</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
