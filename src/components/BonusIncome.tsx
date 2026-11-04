import { useAppChallenges } from "@/lib/data";
import { receivedBonuses } from "@/lib/app-challenges";
import { brl, dateTimeLabel, downloadCsv } from "@/lib/format";
import { EmptyState, SectionCard } from "./ui-kit";
import { Button } from "./ui/button";

export function BonusIncome({
  from,
  to,
  deliveryRevenue,
}: {
  from: Date;
  to: Date;
  deliveryRevenue: number;
}) {
  const query = useAppChallenges();
  const rows = receivedBonuses(query.data ?? [], from, to);
  const bonus = rows.reduce((n, r) => n + Number(r.reward), 0);
  return (
    <SectionCard
      className="mt-4"
      title="Composição da receita e bonificações"
      description="Bonificações pela data do crédito automático ou da confirmação manual; metas pendentes não entram nos totais."
      actions={
        <Button
          className="no-print"
          variant="outline"
          size="sm"
          disabled={query.isPending || query.isError || !rows.length}
          onClick={() =>
            downloadCsv("bonificacoes-delivery-os.csv", [
              ["Aplicativo", "Desafio", "Creditado em", "Valor"],
              ...rows.map((r) => [
                r.app_name,
                r.title,
                dateTimeLabel(r.received_at!),
                Number(r.reward),
              ]),
            ])
          }
        >
          Exportar bonificações (Excel)
        </Button>
      }
    >
      {query.isPending ? (
        <p role="status" className="text-sm">
          Carregando bonificações; totais ainda parciais.
        </p>
      ) : query.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Bonificações indisponíveis. Os totais exibidos podem estar incompletos. Verifique a
          conexão. Se o problema persistir, contate a administração.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              ["Entregas e gratificações do cliente", deliveryRevenue],
              ["Bonificações creditadas", bonus],
              ["Receita total", deliveryRevenue + bonus],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-muted/50 p-3">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 font-semibold tabular-nums">{brl(Number(value))}</dd>
              </div>
            ))}
          </dl>
          {rows.length ? (
            <ul className="mt-3 divide-y divide-border">
              {rows.map((r) => (
                <li key={r.id} className="flex justify-between gap-3 py-2 text-sm">
                  <div>
                    <p className="font-medium">
                      {r.app_name} · {r.title}
                    </p>
                    <p className="text-xs text-muted-foreground">{dateTimeLabel(r.received_at!)}</p>
                  </div>
                  <span className="shrink-0 tabular-nums">{brl(Number(r.reward))}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-3">
              <EmptyState>Nenhuma bonificação creditada neste período.</EmptyState>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}
