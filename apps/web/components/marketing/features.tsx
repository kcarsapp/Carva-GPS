import { Camera, Fuel, MapPin, Wrench, type LucideIcon } from "lucide-react";

interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
  accent: string;
}

const features: Feature[] = [
  {
    icon: MapPin,
    title: "Real-time GPS tracking",
    description:
      "See every vehicle on a live map with sub-30-second updates, trip history, and instant geofence alerts.",
    accent: "bg-indigo-500/10 text-indigo-500",
  },
  {
    icon: Camera,
    title: "AI dashcams & safety",
    description:
      "Road-facing AI detects harsh braking, distraction, and tailgating — then scores and coaches drivers automatically.",
    accent: "bg-emerald-500/10 text-emerald-500",
  },
  {
    icon: Wrench,
    title: "Automated maintenance",
    description:
      "Predictive service scheduling from engine diagnostics and mileage keeps your fleet on the road, not in the shop.",
    accent: "bg-amber-500/10 text-amber-500",
  },
  {
    icon: Fuel,
    title: "Fuel optimization",
    description:
      "Spot idling, fuel theft, and inefficient routes. Cut fuel spend by up to 15% with AI route suggestions.",
    accent: "bg-sky-500/10 text-sky-500",
  },
];

export function Features() {
  return (
    <section id="features" className="border-t bg-muted/20 py-20">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Everything your fleet needs, in one platform
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Four core pillars working together to keep your vehicles safe,
            efficient, and always accounted for.
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl border bg-card p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg"
            >
              <span
                className={`flex h-12 w-12 items-center justify-center rounded-xl ${f.accent}`}
              >
                <f.icon className="h-6 w-6" />
              </span>
              <h3 className="mt-5 text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {f.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
