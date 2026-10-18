import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { GpsRoutePoint } from "@/lib/gps-integration";

export function GpsRouteMap({ points }: { points: GpsRoutePoint[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current || points.length === 0) return;

    let map: import("leaflet").Map | null = null;
    let cancelled = false;

    void import("leaflet").then((L) => {
      if (cancelled || !containerRef.current) return;

      const latLngs = points.map(
        (point) => [Number(point.latitude), Number(point.longitude)] as [number, number],
      );

      map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);

      const route = L.polyline(latLngs, {
        weight: 5,
        opacity: 0.85,
      }).addTo(map);

      const first = latLngs[0];
      const last = latLngs[latLngs.length - 1];

      if (first) {
        L.circleMarker(first, {
          radius: 7,
          weight: 2,
          fillOpacity: 1,
        })
          .bindTooltip("Início")
          .addTo(map);
      }

      if (last) {
        L.circleMarker(last, {
          radius: 7,
          weight: 2,
          fillOpacity: 1,
        })
          .bindTooltip("Fim")
          .addTo(map);
      }

      if (latLngs.length === 1 && first) {
        map.setView(first, 17);
      } else {
        map.fitBounds(route.getBounds(), { padding: [24, 24] });
      }
    });

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [points]);

  if (points.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-lg border border-border bg-muted/20 text-sm text-muted-foreground">
        Esta jornada ainda não possui pontos GPS.
      </div>
    );
  }

  return <div ref={containerRef} className="h-80 w-full overflow-hidden rounded-lg border border-border" />;
}
