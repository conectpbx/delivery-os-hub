import { useState } from "react";
import { Coffee, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PAUSE_REASONS, type JourneyPause } from "@/lib/operation-time";
import { dateTimeLabel } from "@/lib/format";

export function JourneyPauseControl({ active, pauses = [], pause, resume }: {
  active: boolean;
  pauses?: JourneyPause[];
  pause: (reason: string) => void;
  resume: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("Almoço");
  const [custom, setCustom] = useState("");
  const current = pauses.find((p) => !p.ended_at);
  return (
    <>
      {current && active ? (
        <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border border-border bg-muted px-3 py-2" role="status">
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-medium text-warning"><Coffee className="mr-2 inline size-4" />Pausado · {current.reason}</p>
            <p className="text-xs text-muted-foreground">Desde {dateTimeLabel(current.started_at)}</p>
          </div>
          <Button onClick={() => { resume(); toast.success("Jornada retomada"); }} className="min-h-11 gap-2"><Play className="size-4" />Retomar</Button>
        </div>
      ) : (
        <Button variant="outline" disabled={!active} onClick={() => setOpen(true)} className="min-h-11 gap-2" title={active ? "Registrar pausa" : "Inicie uma jornada para registrar pausas"}>
          <Pause className="size-4" />Pausar jornada
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Motivo da pausa</DialogTitle></DialogHeader>
          <div role="radiogroup" aria-label="Motivo da pausa" className="grid grid-cols-2 gap-2">
            {PAUSE_REASONS.map((item) => <Button key={item} role="radio" aria-checked={reason === item} variant={reason === item ? "default" : "outline"} className="min-h-11" onClick={() => setReason(item)}>{item}</Button>)}
          </div>
          {reason === "Outros" ? <div className="space-y-2"><Label htmlFor="pause-reason">Qual motivo?</Label><Input id="pause-reason" value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={80} placeholder="Motivo da pausa" /></div> : null}
          <Button className="min-h-11 gap-2" disabled={!active || (reason === "Outros" && !custom.trim())} onClick={() => { pause(reason === "Outros" ? custom.trim() : reason); setOpen(false); setCustom(""); toast.success("Pausa iniciada"); }}><Pause className="size-4" />Iniciar pausa</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}