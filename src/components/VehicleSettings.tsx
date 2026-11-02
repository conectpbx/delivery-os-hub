import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Bike, Car, Check, Footprints, Motorbike, Scooter, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { BrandSpinner } from "@/components/BrandLoader";

const vehicles = [
  { value: "Moto", icon: Motorbike },
  { value: "Carro", icon: Car },
  { value: "Bicicleta", icon: Bike },
  { value: "Patinete", icon: Scooter },
  { value: "A pé", icon: Footprints },
];

export function VehicleSettings({ profile, userId }: { profile: Profile | null | undefined; userId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!selected || saving) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.from("profiles")
        .upsert({ id: userId, vehicle: selected }, { onConflict: "id" })
        .select("*").single();
      if (error) throw error;
      queryClient.setQueryData(["profile"], data);
      setOpen(false);
      toast.success("Veículo atualizado");
    } catch {
      toast.error("Não foi possível salvar o veículo. Verifique sua conexão e tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) { setOpen(next); setSelected(null); } }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="shrink-0" aria-label="Configurar veículo" title="Configurar veículo">
          <Settings2 /> <span className="hidden sm:inline">Veículo</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg">
        <DialogHeader>
          <DialogTitle>Seu veículo</DialogTitle>
          <DialogDescription>Veículo de trabalho e desenho de carregamento</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Atual: {profile?.vehicle || "Não definido"}</p>
        <div role="group" aria-label="Tipo de veículo" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {vehicles.map(({ value, icon: Icon }) => (
            <Button key={value} variant={selected === value ? "default" : "outline"}
              className="h-16 flex-col gap-1" aria-pressed={selected === value}
              disabled={saving} onClick={() => setSelected(value)}>
              <Icon /> {value}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t border-border pt-4">
          <BrandSpinner vehicle={selected ?? profile?.vehicle} />
          <span className="text-sm text-muted-foreground">{selected ?? profile?.vehicle ?? "Moto"}</span>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancelar</Button>
          <Button disabled={!selected || saving} onClick={() => void save()}>
            <Check /> {saving ? "Salvando…" : "Salvar veículo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}