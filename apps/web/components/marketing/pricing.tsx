"use client";

import * as React from "react";
import Link from "next/link";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { pricingTiers } from "@/mock/metrics";

export function Pricing() {
  const [annual, setAnnual] = React.useState(true);

  return (
    <section className="py-16 sm:py-20">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Simple, transparent pricing
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Per vehicle, per month. Switch plans or cancel anytime.
          </p>

          <div className="mt-8 inline-flex items-center gap-3 rounded-full border bg-card px-4 py-2">
            <span
              className={cn(
                "text-sm font-medium",
                !annual ? "text-foreground" : "text-muted-foreground",
              )}
            >
              Monthly
            </span>
            <Switch checked={annual} onCheckedChange={setAnnual} aria-label="Toggle annual billing" />
            <span
              className={cn(
                "text-sm font-medium",
                annual ? "text-foreground" : "text-muted-foreground",
              )}
            >
              Annual
            </span>
            <Badge variant="success" className="ml-1">
              Save 20%
            </Badge>
          </div>
        </div>

        <div className="mx-auto mt-12 grid max-w-5xl gap-6 lg:grid-cols-3">
          {pricingTiers.map((tier) => {
            const isEnterprise = tier.id === "enterprise";
            const price = annual ? tier.annual : tier.monthly;
            return (
              <div
                key={tier.id}
                className={cn(
                  "relative flex flex-col rounded-2xl border bg-card p-6 shadow-sm",
                  tier.highlighted &&
                    "border-primary shadow-lg ring-1 ring-primary",
                )}
              >
                {tier.highlighted && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                    Most popular
                  </Badge>
                )}

                <h3 className="text-lg font-semibold">{tier.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {tier.description}
                </p>

                <div className="mt-5 flex items-end gap-1">
                  {isEnterprise ? (
                    <span className="text-3xl font-bold">Custom</span>
                  ) : (
                    <>
                      <span className="text-4xl font-bold tracking-tight">
                        ${price}
                      </span>
                      <span className="mb-1 text-sm text-muted-foreground">
                        /vehicle/mo
                      </span>
                    </>
                  )}
                </div>
                {!isEnterprise && annual && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    billed annually
                  </p>
                )}

                <Button
                  className="mt-6"
                  variant={tier.highlighted ? "default" : "outline"}
                  asChild
                >
                  <Link href="/fleet">{tier.cta}</Link>
                </Button>

                <ul className="mt-6 space-y-3 border-t pt-6">
                  {tier.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-2 text-sm">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                      <span className="text-muted-foreground">{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
