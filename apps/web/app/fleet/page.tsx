"use client";

import * as React from "react";

import { FleetMap } from "@/components/dashboard/fleet-map";
import {
  AlertsPanel,
  CommandBar,
  RosterWindow,
} from "@/components/dashboard/map-windows";
import { PersonalDashboard } from "@/components/dashboard/personal-dashboard";
import { useLiveFleet, computeLiveMetrics, overviewAlerts } from "@/lib/live-data";
import { useI18n } from "@/lib/i18n-provider";

/**
 * Fleet overview: a full-viewport live map with the rest of the dashboard
 * floating over it as glass windows (command bar, roster, alerts, detail).
 * The `fixed inset-0` overlay deliberately covers the shared sidebar shell —
 * navigation moves into the command bar on this page only.
 */
export default function FleetOverviewPage() {
  const { vehicles, authed, error, user, transport } = useLiveFleet();
  const { t } = useI18n();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  // Separate from the selection: only a click on the map marker itself opens
  // the anchored card, so picking a roster row does not double up.
  const [calloutId, setCalloutId] = React.useState<string | null>(null);
  const [alertsOpen, setAlertsOpen] = React.useState(false);

  // Deep link: /fleet?device=<traccarDeviceId> pre-selects a vehicle (used by
  // the admin panel's "show on map"). Applied once vehicles have loaded so the
  // map's fly-to sees the position.
  const pendingDeviceRef = React.useRef<string | null>(
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("device")
      : null,
  );
  React.useEffect(() => {
    const id = pendingDeviceRef.current;
    if (id && vehicles.some((v) => v.id === id)) {
      setSelectedId(id);
      pendingDeviceRef.current = null;
    }
  }, [vehicles]);

  // Personal accounts keep the focused single-vehicle tracker (sidebar shell).
  if (user?.role === "personal") {
    return (
      <PersonalDashboard vehicles={vehicles} authed={authed} error={error} />
    );
  }

  const metrics = computeLiveMetrics(vehicles);
  const alerts = overviewAlerts(vehicles, authed, t);

  return (
    // Fills the shell's canvas frame — the sidebar stays visible beside it, so
    // navigation no longer jumps between a rail here and a floating bar there.
    <div className="absolute inset-0 overflow-hidden bg-muted">
      <FleetMap
        vehicles={vehicles}
        selectedId={selectedId}
        calloutId={calloutId}
        onSelect={setSelectedId}
        onMarkerSelect={(id) => {
          setSelectedId(id);
          setCalloutId(id);
        }}
        onClose={() => setCalloutId(null)}
        className="h-full w-full rounded-none border-0"
        controlsClassName="end-3 top-[4.75rem]"
        showDetail
        anchorDetail
        canControl={authed}
        allowDirections={authed}
      />

      <CommandBar
        authed={authed}
        user={user}
        metrics={metrics}
        alertCount={alerts.length}
        alertsOpen={alertsOpen}
        onToggleAlerts={() => setAlertsOpen((v) => !v)}
        transport={transport}
      />

      <RosterWindow
        vehicles={vehicles}
        selectedId={selectedId}
        onSelect={(id) =>
          setSelectedId((prev) => (prev === id ? null : id))
        }
        canControl={authed}
      />

      {alertsOpen && (
        <AlertsPanel
          alerts={alerts}
          authed={authed}
          onClose={() => setAlertsOpen(false)}
        />
      )}

      {error && (
        <div className="absolute left-1/2 top-[4.75rem] z-30 -translate-x-1/2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive shadow-lg backdrop-blur-md">
          {error}
        </div>
      )}
    </div>
  );
}
