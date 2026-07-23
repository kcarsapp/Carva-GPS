"use client";

import * as React from "react";

import { Switch } from "@/components/ui/switch";

const OPTIONS = [
  { id: "safety", label: "Safety & speeding alerts", default: true },
  { id: "maintenance", label: "Maintenance reminders", default: true },
  { id: "geofence", label: "Geofence entry/exit", default: false },
  { id: "fuel", label: "Low fuel / battery", default: true },
  { id: "weekly", label: "Weekly summary email", default: false },
];

export function SettingsToggles() {
  const [state, setState] = React.useState<Record<string, boolean>>(
    Object.fromEntries(OPTIONS.map((o) => [o.id, o.default])),
  );

  return (
    <div className="space-y-4">
      {OPTIONS.map((o) => (
        <div key={o.id} className="flex items-center justify-between gap-4">
          <span className="text-sm">{o.label}</span>
          <Switch
            checked={state[o.id]}
            onCheckedChange={(v) =>
              setState((prev) => ({ ...prev, [o.id]: v }))
            }
          />
        </div>
      ))}
    </div>
  );
}
