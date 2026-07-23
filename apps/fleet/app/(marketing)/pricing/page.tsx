import type { Metadata } from "next";

import { Pricing } from "@/components/marketing/pricing";
import { CtaBanner } from "@/components/marketing/cta";

export const metadata: Metadata = {
  title: "Pricing — Carva Fleet",
  description: "Simple per-vehicle pricing. Starter, Pro, and Enterprise plans.",
};

const faqs = [
  {
    q: "Do I need GPS hardware to start?",
    a: "No. You can explore the full dashboard on demo data instantly. When you're ready, we ship plug-and-play OBD trackers or integrate your existing hardware.",
  },
  {
    q: "Can I change plans later?",
    a: "Yes — upgrade, downgrade, or cancel anytime. Annual plans are prorated on change.",
  },
  {
    q: "Is there a setup fee?",
    a: "Never. Starter and Pro are fully self-serve. Enterprise includes white-glove onboarding.",
  },
  {
    q: "What counts as a 'vehicle'?",
    a: "Any tracked asset — trucks, vans, trailers, or EVs. You're billed only for active units each month.",
  },
];

export default function PricingPage() {
  return (
    <>
      <section className="border-b bg-grid py-14 text-center">
        <div className="container">
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
            Pricing that scales with your fleet
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
            Start free for 14 days. No credit card, no hardware lock-in.
          </p>
        </div>
      </section>

      <Pricing />

      <section className="border-t py-16">
        <div className="container max-w-3xl">
          <h2 className="text-center text-2xl font-bold tracking-tight">
            Frequently asked questions
          </h2>
          <div className="mt-8 divide-y rounded-2xl border bg-card">
            {faqs.map((f) => (
              <div key={f.q} className="p-6">
                <h3 className="font-semibold">{f.q}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CtaBanner />
    </>
  );
}
