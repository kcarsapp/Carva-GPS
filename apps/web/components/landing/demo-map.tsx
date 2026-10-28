"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Gauge, Loader2, Radio } from "lucide-react";
import type maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { Button } from "@/components/ui/button";
import { vehicleSvg } from "@/app/app/icons";
import { DEMO_LOOPS } from "@/components/landing/city-data";
import { useLandingCopy } from "@/components/landing/copy";
import { enter, gsap, MQ } from "@/components/landing/gsap";
import { STREET_ATTRIBUTION, STREET_MAX_ZOOM, STREET_TILES } from "@/lib/basemaps";
import { buildTrack, trackAt as at } from "@/lib/demo-fleet";

/**
 * Interactive demo map. Real MapLibre + the dashboard's night style, with
 * three SIMULATED cars driving real Erbil streets (city-data.ts). Clearly
 * badged as a demo; it never touches real fleet data.
 *
 * Cost control: maplibre-gl is imported only when the section comes within
 * ~600px of the viewport, the animation pauses whenever the map is off
 * screen or the tab is hidden, and cooperative gestures stop the map from
 * swallowing page scroll.
 */

const CARS = [
  { name: "01", kmh: 42, color: "#10b981" },
  { name: "02", kmh: 51, color: "#10b981" },
  { name: "03", kmh: 36, color: "#10b981" },
];

export function LandingDemoMap() {
  const c = useLandingCopy();
  const root = React.useRef<HTMLElement>(null);
  const mapBox = React.useRef<HTMLDivElement>(null);
  const [near, setNear] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [selected, setSelected] = React.useState<number | null>(0);
  const selectedRef = React.useRef<number | null>(0);
  selectedRef.current = selected;

  // Load the map only when the section is close.
  React.useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  React.useEffect(() => {
    if (!near || !mapBox.current) return;
    let disposed = false;
    let map: maplibregl.Map | null = null;
    let raf = 0;
    let visible = true;
    const markers: maplibregl.Marker[] = [];
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0.05 });

    (async () => {
      const { default: ml } = await import("maplibre-gl");
      if (disposed || !mapBox.current) return;
      map = new ml.Map({
        container: mapBox.current,
        style: {
          version: 8,
          sources: {
            osm: { type: "raster", tiles: STREET_TILES, tileSize: 256, maxzoom: STREET_MAX_ZOOM, attribution: STREET_ATTRIBUTION },
          },
          layers: [
            {
              id: "osm",
              type: "raster",
              source: "osm",
              // The dashboard's night map: inverted, hue restored, desaturated.
              paint: {
                "raster-brightness-min": 0.86,
                "raster-brightness-max": 0.07,
                "raster-hue-rotate": 180,
                "raster-saturation": -0.7,
                "raster-contrast": 0.08,
              },
            },
          ],
        },
        center: [44.0115, 36.1905],
        zoom: 13.3,
        attributionControl: { compact: true },
        cooperativeGestures: true,
        dragRotate: false,
        pitchWithRotate: false,
      });
      map.addControl(new ml.NavigationControl({ showCompass: false }), "bottom-right");

      const tracks = DEMO_LOOPS.map(buildTrack);
      const dist = tracks.map((t, i) => (t.total * i) / 3);
      tracks.forEach((t, i) => {
        const el = document.createElement("div");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "vm";
        btn.setAttribute("aria-label", `${c.demo.car} ${CARS[i].name}`);
        btn.style.setProperty("--vm-color", CARS[i].color);
        btn.innerHTML =
          `<span data-heading style="position:absolute;inset:-9px;pointer-events:none">` +
          `<svg viewBox="0 0 52 52" width="100%" height="100%" aria-hidden="true"><path d="M26 1 L32 10 L20 10 Z" fill="${CARS[i].color}" stroke="#12100e" stroke-width="1.5" stroke-linejoin="round"/></svg></span>` +
          `<span style="width:17px;height:17px;display:block">${vehicleSvg(null)}</span>`;
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          setSelected(i);
          const p = at(t, dist[i]).ll;
          map?.easeTo({ center: p, zoom: Math.max(map.getZoom(), 14.5), duration: 700 });
        });
        el.appendChild(btn);
        markers.push(new ml.Marker({ element: el }).setLngLat(at(t, dist[i]).ll).addTo(map!));
      });

      const still = window.matchMedia(MQ.reduce).matches;
      let last = performance.now();
      const frame = (now: number) => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (visible && !document.hidden && !still) {
          tracks.forEach((t, i) => {
            // A touch faster than real time so the motion reads on screen.
            dist[i] += (CARS[i].kmh / 3.6) * dt * 2.2;
            const { ll, bearing } = at(t, dist[i]);
            markers[i].setLngLat(ll);
            const btn = markers[i].getElement().firstElementChild as HTMLElement;
            btn.dataset.selected = String(selectedRef.current === i);
            const ptr = btn.querySelector<HTMLElement>("[data-heading]");
            if (ptr) ptr.style.transform = `rotate(${bearing.toFixed(1)}deg)`;
          });
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      map.once("load", () => !disposed && setReady(true));
      io.observe(mapBox.current);
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      markers.forEach((m) => m.remove());
      map?.remove();
    };
    // Copy is read once for marker labels; the map must not rebuild on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near]);

  // Section entrance.
  React.useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const q = gsap.utils.selector(el);
    const mm = gsap.matchMedia();
    mm.add(`${MQ.desktop}, ${MQ.mobile}`, () => {
      gsap.from(q(".ld-copy > *"), {
        y: 28,
        autoAlpha: 0,
        stagger: 0.09,
        duration: 1,
        ease: "expo.out",
        scrollTrigger: { trigger: el, start: enter(75) },
      });
      gsap.from(q(".ld-frame"), {
        clipPath: "inset(12% 12% 12% 12% round 28px)",
        scale: 0.94,
        autoAlpha: 0,
        duration: 1.4,
        ease: "expo.out",
        scrollTrigger: { trigger: el, start: enter(75) },
      });
    });
    return () => mm.revert();
  }, []);

  const car = selected != null ? CARS[selected] : null;

  return (
    <section id="demo" ref={root} className="ld-section relative py-28" aria-labelledby="ld-title">
      <div className="container grid items-center gap-12 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="ld-copy">
          <p className="eyebrow !text-[hsl(var(--gold))]">{c.demo.eyebrow}</p>
          <h2 id="ld-title" className="font-display mt-3 text-[clamp(2rem,4.2vw,3.2rem)] font-semibold leading-tight tracking-tight">
            {c.demo.title}
          </h2>
          <p className="mt-4 max-w-md text-[17px] leading-relaxed text-[#f4efe6]/80">{c.demo.body}</p>
          <span className="mt-6 inline-flex items-center gap-2 rounded-full border border-[hsl(var(--gold))]/30 bg-[hsl(var(--gold))]/10 px-3 py-1.5 text-xs font-medium text-[hsl(var(--gold))]">
            <Radio className="h-3.5 w-3.5" />
            {c.demo.badge}
          </span>
          <div className="mt-8">
            <Button asChild variant="outline" className="h-11 border-white/15 bg-white/[0.03] px-5 text-[#f4efe6] hover:bg-white/[0.07]">
              {/* The demo dashboard: simulated fleet, no account needed. */}
              <Link href="/fleet">
                {c.demo.open}
                <ArrowRight className="rtl:rotate-180" />
              </Link>
            </Button>
          </div>
        </div>

        <div className="ld-frame relative aspect-[4/3] overflow-hidden rounded-[28px] border border-white/10 bg-[#0b0a09] shadow-[0_40px_120px_-40px_rgba(209,176,107,0.35)] sm:aspect-[16/11]">
          {/* h-full/w-full matter: maplibre-gl.css forces position:relative on
              its container, which cancels inset-0 and collapses it to 0px. */}
          <div ref={mapBox} className="absolute inset-0 h-full w-full" />
          {!ready && (
            <div className="absolute inset-0 grid place-items-center text-sm text-[#f4efe6]/50">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {c.demo.loading}
              </span>
            </div>
          )}
          {/* HUD corners */}
          <span className="ld-corner start-3 top-3" aria-hidden />
          <span className="ld-corner end-3 top-3 rotate-90" aria-hidden />
          <span className="ld-corner bottom-3 end-3 rotate-180" aria-hidden />
          <span className="ld-corner bottom-3 start-3 -rotate-90" aria-hidden />

          <span className="absolute start-4 top-4 z-10 rounded-full border border-white/10 bg-black/55 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-[#f4efe6]/80 backdrop-blur">
            {c.demo.badge}
          </span>

          {car && (
            <div className="glass glass-sheen pop absolute bottom-4 start-4 z-10 w-52 rounded-xl p-3" key={selected}>
              <p className="text-sm font-semibold">
                {c.demo.car} {car.name}
              </p>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="inline-flex items-center gap-1.5 text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {c.demo.moving}
                </span>
                <span className="inline-flex items-center gap-1 text-[#f4efe6]/80">
                  <Gauge className="h-3.5 w-3.5" />
                  <span className="num font-semibold text-[#f4efe6]">{car.kmh}</span> km/h
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
