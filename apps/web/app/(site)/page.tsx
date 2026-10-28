import type { Metadata } from "next";

import { LandingHero } from "@/components/landing/hero";
import { LandingStats } from "@/components/landing/stats";
import { LandingStory } from "@/components/landing/story";
import { LandingFeatures } from "@/components/landing/features";
import { LandingDemoMap } from "@/components/landing/demo-map";
import { LandingSteps } from "@/components/landing/steps";
import { LandingCta } from "@/components/landing/final-cta";
import "./landing.css";

export const metadata: Metadata = {
  title: "Carva Fleet — GPS tracking for car rental companies",
  description:
    "See every rental car on a live map, get warned when one leaves its zone or loses power, and stop the engine safely from your phone. English, Arabic and Kurdish.",
};

/**
 * The public homepage: one night drive through Erbil, told by scrolling.
 * Hero (the city switches on) → Story (pinned: leaves the lot, crosses a
 * line, safe engine cut, directions to the car) → Features → live demo map →
 * three steps → call to action. Animation lives in components/landing/*
 * (GSAP, loaded on this page only); every scene has a reduced-motion state.
 */
export default function HomePage() {
  return (
    <div className="landing -mt-16">
      <LandingHero />
      <LandingStats />
      <LandingStory />
      <LandingFeatures />
      <LandingDemoMap />
      <LandingSteps />
      <LandingCta />
    </div>
  );
}
