import { useState } from "react";
import { Pencil, Route } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { useUpdate, type Delivery } from "@/lib/data";
import { historyStops, routeTotals } from "@/lib/delivery-records";
import { deliveryEntryDistance } from "@/lib/distance-values";
import { num } from "@/lib/format";

export function DeliveryDistanceEditor({ delivery }: { delivery: Delivery }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [calculating, setCalculating] = useState(false);
  const [estimate, setEstimate] = useState<string | null>(null);
  const update = useUpdate<Record<string, unknown>>("deliveries", "deliveries");
  const busy = calculating || update.isPending;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
      <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11"
        aria-label="Corrigir quilômetros" title="Corrigir quilômetros"
        onClick={() => { setValue(String(delivery.distance_km)); setEstimate(null); setOpen(true); }}>
        <Pencil className="size-4" />
      </Button>
      <DialogContent className="max-w-[min(28rem,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>Quilômetros da entrega</DialogTitle>
          <DialogDescription>{delivery.app_name} · Confira a distância antes de salvar.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          try {
            if (!value.trim()) throw new Error("Informe a distância da entrega.");
            const distance = deliveryEntryDistance(value);
            await update.mutateAsync({ id: delivery.id, values: { distance_km: distance } });
            toast.success(`Quilometragem salva · ${num(distance, 2)} km`);
            setOpen(false);
          } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível salvar os quilômetros."); }
        }}>
          <label className="block space-y-2 text-sm font-medium">
            Distância (km)
            <Input value={value} required inputMode="decimal" disabled={busy}
              onChange={(event) => { setValue(event.target.value); setEstimate(null); }} />
          </label>
          <Button type="button" variant="outline" className="min-h-11 w-full" disabled={busy || historyStops(delivery).length < 2}
            onClick={async () => {
              setCalculating(true);
              try {
                const totals = await routeTotals(historyStops(delivery));
                if (!totals || totals.distanceKm <= 0) throw new Error("Não há pontos suficientes para calcular. Informe os quilômetros manualmente.");
                setValue(String(totals.distanceKm));
                setEstimate(totals.approximate ? "Estimativa aproximada pelos pontos GPS — não é a leitura do odômetro." : "Estimativa da rota por ruas — não é a leitura do odômetro.");
              } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível calcular a rota."); }
              finally { setCalculating(false); }
            }}>
            <Route className="mr-2 size-4" />{calculating ? "Calculando…" : "Estimar pelos pontos da rota"}
          </Button>
          {estimate && <p role="status" className="text-sm text-muted-foreground">{estimate}</p>}
          <Button type="submit" className="min-h-11 w-full" disabled={busy}>{update.isPending ? "Salvando…" : "Salvar quilômetros"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}