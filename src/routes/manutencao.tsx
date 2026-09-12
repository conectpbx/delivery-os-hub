import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { EmptyState, SectionCard, StatCard } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useInsert, useMaintenances, useRemove } from "@/lib/data";
import { brl, dateLabel, dec, num } from "@/lib/format";
import { maintenanceReservePerKm } from "@/lib/metrics";

export const Route = createFileRoute("/manutencao")({
  head: () => ({
    meta: [
      { title: "Agenda de manutenção do veículo — Delivery OS" },
      {
        name: "description",
        content:
          "Cadastre trocas de óleo, pneus e revisões, acompanhe custos e receba lembretes por data ou quilometragem.",
      },
      { property: "og:title", content: "Agenda de manutenção — Delivery OS" },
      {
        property: "og:description",
        content: "Histórico e lembretes de manutenção da sua moto ou carro de entrega.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Manutencao,
});

const TYPES = ["Troca de óleo", "Pneus", "Freios", "Relação", "Revisão geral", "Outros"];

function Manutencao() {
  const list = useMaintenances();
  const add = useInsert("maintenances", "maintenances");
  const del = useRemove("maintenances", "maintenances");
  const [form, setForm] = useState({
    service_type: TYPES[0]!,
    cost: "",
    odometer: "",
    notes: "",
    next_due_date: "",
    next_due_km: "",
  });

  const data = list.data ?? [];
  const total = data.reduce((s, m) => s + Number(m.cost), 0);
  const reserve = maintenanceReservePerKm(data);
  const previewInterval = dec(form.next_due_km) - dec(form.odometer);
  const previewCostPerKm = previewInterval > 0 ? dec(form.cost) / previewInterval : 0;
  const today = new Date().toISOString().slice(0, 10);
  const pending = data.filter((m) => m.next_due_date && m.next_due_date >= today);
  const overdue = data.filter((m) => m.next_due_date && m.next_due_date < today);

  return (
    <AppShell title="Manutenção" subtitle="Histórico e agenda preventiva do veículo">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Investido em manutenção" value={brl(total)} tone="primary" />
        <StatCard
          label="Reserva de manutenção"
          value={`${brl(reserve.costPerKm)}/km`}
          hint={`${reserve.items.length} serviço(s) no cálculo`}
          tone="warning"
        />
        <StatCard label="Agendamentos futuros" value={String(pending.length)} />
        <StatCard
          label="Dados pendentes"
          value={String(reserve.incomplete.length)}
          hint="Sem intervalo válido em km"
          tone={reserve.incomplete.length ? "destructive" : "default"}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[380px_1fr]">
        <SectionCard title="Novo serviço">
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              await add.mutateAsync({
                service_type: form.service_type,
                cost: Number(form.cost || 0),
                odometer: form.odometer ? Number(form.odometer) : null,
                description: form.notes || null,
                next_due_date: form.next_due_date || null,
                next_due_km: form.next_due_km ? Number(form.next_due_km) : null,
              });
              setForm({ ...form, cost: "", odometer: "", notes: "", next_due_date: "", next_due_km: "" });
              toast.success("Manutenção registrada");
            }}
          >
            <div className="space-y-2">
              <Label className="text-xs">Serviço</Label>
              <select
                value={form.service_type}
                onChange={(e) => setForm({ ...form, service_type: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs">Custo (R$)</Label>
                <Input value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Odômetro atual</Label>
                <Input value={form.odometer} onChange={(e) => setForm({ ...form, odometer: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Próxima data</Label>
                <Input
                  type="date"
                  value={form.next_due_date}
                  onChange={(e) => setForm({ ...form, next_due_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Próximo serviço (km)</Label>
                <Input value={form.next_due_km} onChange={(e) => setForm({ ...form, next_due_km: e.target.value })} />
              </div>
            </div>
            <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
              <p className="font-medium">Prévia da reserva: {brl(previewCostPerKm)}/km</p>
              <p className="mt-1 text-muted-foreground">
                {previewInterval > 0
                  ? `${brl(dec(form.cost))} distribuídos por ${num(previewInterval, 0)} km.`
                  : "Informe o odômetro atual e o próximo serviço em km para calcular."}
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Observações</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <Button type="submit" className="w-full">
              Salvar manutenção
            </Button>
          </form>
        </SectionCard>

        <SectionCard title="Histórico" description={`${data.length} serviços registrados`}>
          {data.length ? (
            <ul className="divide-y divide-border">
              {data.map((m) => {
                const late = m.next_due_date && m.next_due_date < today;
                const reserveItem = reserve.items.find((item) => item.maintenance.id === m.id);
                return (
                  <li key={m.id} className="flex items-start gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {m.service_type} · {brl(Number(m.cost))}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {dateLabel(m.performed_at)}
                        {m.odometer ? ` · ${num(Number(m.odometer), 0)} km` : ""}
                        {m.description ? ` · ${m.description}` : ""}
                      </p>
                      {m.next_due_date || m.next_due_km ? (
                        <p
                          className={`mt-1 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${
                            late ? "bg-destructive/10 text-destructive" : "bg-accent text-accent-foreground"
                          }`}
                        >
                          {late ? <AlertTriangle className="size-3" /> : null}
                          Próxima: {m.next_due_date ? dateLabel(m.next_due_date) : ""}
                          {m.next_due_km ? ` ou ${num(Number(m.next_due_km), 0)} km` : ""}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {reserveItem
                          ? `${brl(reserveItem.costPerKm)}/km · custo diluído em ${num(reserveItem.intervalKm, 0)} km`
                          : "Fora da reserva: informe um intervalo válido em km ou este não é o ciclo mais recente."}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" aria-label="Excluir" onClick={() => del.mutate(m.id)}>
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState>Nenhuma manutenção registrada.</EmptyState>
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}
