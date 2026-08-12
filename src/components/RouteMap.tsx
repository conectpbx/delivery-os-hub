import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

type Props = {
  coords: [number, number][];
  points: [number, number][];
  className?: string;
};

export default function RouteMap({ coords, points, className }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !ref.current) return;

      if (!mapRef.current) {
        mapRef.current = L.map(ref.current, { zoomControl: false, attributionControl: false });
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(
          mapRef.current,
        );
      }
      const map = mapRef.current;
      map.eachLayer((layer) => {
        if (!(layer instanceof L.TileLayer)) map.removeLayer(layer);
      });

      if (coords.length) {
        const line = L.polyline(coords, { color: "#1D4ED8", weight: 5, opacity: 0.85 }).addTo(map);
        map.fitBounds(line.getBounds(), { padding: [24, 24] });
      }

      points.forEach(([lat, lng], i) => {
        const last = i === points.length - 1;
        L.marker([lat, lng], {
          icon: L.divIcon({
            className: "",
            html: `<span style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:9999px;background:${
              last ? "#0F172A" : "#1D4ED8"
            };color:#fff;font:600 12px/1 system-ui;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)">${i + 1}</span>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          }),
        }).addTo(map);
      });

      if (!coords.length && points.length) {
        map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 15 });
      }
      setTimeout(() => map.invalidateSize(), 60);
    })();
    return () => {
      cancelled = true;
    };
  }, [coords, points]);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
    },
    [],
  );

  return <div ref={ref} className={className ?? "h-64 w-full rounded-md"} />;
}
