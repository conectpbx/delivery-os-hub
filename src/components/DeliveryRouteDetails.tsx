import { memo, useState } from "react";
import { DeliveryStopAddress } from "./DeliveryStopAddress";
import { dateTimeLabel } from "@/lib/format";
import type { StoredStop } from "@/lib/delivery-records";

export const DeliveryRouteDetails = memo(function DeliveryRouteDetails({
  stops,
}: {
  stops: StoredStop[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="mt-3 rounded-lg border border-border px-3"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="min-h-11 cursor-pointer py-3 text-xs font-medium">
        Ver percurso · {stops.length} pontos
      </summary>
      {open && (
        <div className="pb-3">
          {stops.length ? (
            <ol className="space-y-0">
              {stops.map((stop, index) => (
                <li
                  key={`${index}-${stop.recorded_at ?? stop.address}`}
                  className="relative flex gap-3 pb-3 last:pb-0"
                >
                  {index < stops.length - 1 ? (
                    <span
                      aria-hidden="true"
                      className="absolute left-[11px] top-6 h-[calc(100%-1.25rem)] w-px bg-border"
                    />
                  ) : null}
                  <span className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-background text-[10px] font-semibold text-primary">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-xs font-semibold capitalize text-foreground">
                        {stop.kind === "coleta" ? "Coleta" : "Entrega"}
                      </span>
                      {stop.recorded_at ? (
                        <span className="text-[11px] text-muted-foreground">
                          {dateTimeLabel(stop.recorded_at)}
                        </span>
                      ) : null}
                    </div>
                    <p className="break-words text-xs text-muted-foreground">
                      <DeliveryStopAddress stop={stop} />
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs text-muted-foreground">
              Os pontos não foram informados neste registro.
            </p>
          )}
        </div>
      )}
    </details>
  );
});
