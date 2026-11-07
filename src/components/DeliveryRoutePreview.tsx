import { MapsNavigationLink } from "@/components/MapsNavigationLink";

import { Suspense, lazy, memo } from "react";

import { Navigation } from "lucide-react";

import { BrandSpinner } from "@/components/BrandLoader";

import { EmptyState, SectionCard } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";

import { minutesLabel, num } from "@/lib/format";

import { type RouteResult, type Stop } from "@/lib/geo";

const RouteMap = lazy(() => import("./RouteMap"));
export const DeliveryRoutePreview = memo(function DeliveryRoutePreview({
  mounted,
  route,
  stops,
  points,
  vehicle,
  filledStops,
  formNav,
  applyRoute,
  applyLeg,
}: {
  mounted: boolean;
  route: RouteResult | null;
  stops: Stop[];
  points: [number, number][];
  vehicle: string | null | undefined;
  filledStops: Stop[];
  formNav: string | null;
  applyRoute: () => void;
  applyLeg: (index: number) => void;
}) {
  return (
    <SectionCard title="Prévia da rota" description="Confirme o trajeto antes de salvar a entrega">
      {mounted && (route?.points.length || stops.some((s) => s.lat != null)) ? (
        <div className="space-y-3">
          <Suspense
            fallback={
              <div className="flex h-64 w-full items-center justify-center rounded-md border border-border bg-muted/40">
                <BrandSpinner vehicle={vehicle} />
              </div>
            }
          >
            <RouteMap
              coords={route?.coords ?? []}
              points={points}
              className="h-64 w-full overflow-hidden rounded-md border border-border"
            />
          </Suspense>
          {route ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium">{num(route.distanceKm)} km</span>
              <span className="text-muted-foreground">
                ~{minutesLabel(route.durationMin)} de trajeto
              </span>
              <Button type="button" size="sm" variant="secondary" onClick={applyRoute}>
                Aplicar no formulário
              </Button>
              {formNav ? (
                <Button asChild size="sm" variant="outline">
                  <MapsNavigationLink href={formNav}>
                    <Navigation className="mr-1 size-4" /> Abrir no Google Maps
                  </MapsNavigationLink>
                </Button>
              ) : null}
            </div>
          ) : null}
          {route && route.legs.length > 1 ? (
            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
              <p className="text-xs font-medium">
                Trechos encadeados ({route.legs.length}) — cada ponto final vira a origem do próximo
              </p>
              <ul className="space-y-1">
                {route.legs.map((leg, i) => {
                  const from = filledStops[i];
                  const to = filledStops[i + 1];
                  return (
                    <li
                      key={i}
                      className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {i + 1}. {from?.address || "Ponto"} → {to?.address || "Ponto"}
                      </span>
                      <span className="font-medium text-foreground">
                        {num(leg.distanceKm)} km · {minutesLabel(leg.durationMin)}
                      </span>
                      <Button type="button" size="sm" variant="ghost" onClick={() => applyLeg(i)}>
                        Aplicar
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {!route ? (
            <p className="text-xs text-muted-foreground">
              Toque em “Ver rota” para traçar o trajeto entre os pontos.
            </p>
          ) : null}
        </div>
      ) : (
        <EmptyState>
          Informe coleta e entrega e toque em “Ver rota” para visualizar o trajeto.
        </EmptyState>
      )}
    </SectionCard>
  );
});
