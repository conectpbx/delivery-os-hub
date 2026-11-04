import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAppChallenges, useApps, useDeliveries, type Delivery } from "@/lib/data";
import {
  challengeProgress,
  challengeSchema,
  normalizedApp,
  type AppChallenge,
} from "@/lib/app-challenges";
import { useSaveChallenge } from "@/lib/use-app-challenges";
import { useCalendarNow } from "@/hooks/useCalendarNow";
import { brl, dateTimeLabel, dec, localDateValue, num } from "@/lib/format";
import { EmptyState, SectionCard } from "./ui-kit";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Progress } from "./ui/progress";

const initialForm = () => ({
  app_name: "",
  title: "",
  start: localDateValue(),
  end: localDateValue(),
  metric: "deliveries" as "deliveries" | "revenue",
  target: "",
  reward: "",
  auto_receive: true,
});
const localDateTime = (date: Date) =>
  `${localDateValue(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

export function AppChallenges() {
  const challenges = useAppChallenges();
  const deliveries = useDeliveries();
  const apps = useApps();
  const mutation = useSaveChallenge();
  const calendarNow = useCalendarNow();
  const now = new Date(Math.max(calendarNow.getTime(), Date.now()));
  const [form, setForm] = useState(initialForm);
  const [editing, setEditing] = useState<string | undefined>();
  const [receipt, setReceipt] = useState(() => localDateTime(new Date()));
  const appNames = useMemo(
    () =>
      [
        ...new Set([
          ...(apps.data ?? []).map((a) => a.name),
          ...(deliveries.data ?? []).map((d) => d.app_name),
        ]),
      ]
        .filter(Boolean)
        .sort(),
    [apps.data, deliveries.data],
  );
  const deliveriesByApp = useMemo(() => {
    const groups = new Map<string, Delivery[]>();
    for (const delivery of deliveries.data ?? []) {
      const key = normalizedApp(delivery.app_name ?? "");
      const rows = groups.get(key) ?? [];
      rows.push(delivery);
      groups.set(key, rows);
    }
    return groups;
  }, [deliveries.data]);
  const change = (key: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  const reset = () => {
    setForm(initialForm());
    setEditing(undefined);
  };
  const edit = (c: AppChallenge) => {
    setEditing(c.id);
    setForm({
      app_name: c.app_name,
      title: c.title,
      start: localDateValue(new Date(c.starts_at)),
      end: localDateValue(new Date(c.ends_at)),
      metric: c.metric,
      target: String(c.target),
      reward: String(c.reward),
      auto_receive: c.auto_receive ?? false,
    });
  };
  const run = async (action: Parameters<typeof mutation.mutateAsync>[0]) => {
    try {
      await mutation.mutateAsync(action);
      toast.success("Desafio atualizado");
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar. Verifique a conexão e a configuração dos desafios.",
      );
      return false;
    }
  };
  return (
    <SectionCard
      className="mt-4"
      title="Desafios e bonificações por aplicativo"
      description="Ao atingir a meta, a bonificação automática é incluída uma única vez na receita e no lucro."
    >
      {challenges.isError ? (
        <div role="alert" className="rounded-lg border border-destructive p-3 text-sm">
          Não foi possível carregar os desafios. Verifique a conexão. Se o problema persistir,
          contate a administração.{" "}
          <Button size="sm" variant="outline" onClick={() => void challenges.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <>
          <form
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!form.start || !form.end) return;
              const parsed = challengeSchema.safeParse({
                auto_receive: form.auto_receive,
                app_name: form.app_name,
                title: form.title,
                starts_at: new Date(`${form.start}T00:00:00`).toISOString(),
                ends_at: new Date(`${form.end}T23:59:59.999`).toISOString(),
                metric: form.metric,
                target: dec(form.target),
                reward: Math.round(dec(form.reward) * 100) / 100,
              });
              if (!parsed.success) {
                toast.error(parsed.error.issues[0]?.message ?? "Confira os campos");
                return;
              }
              if (await run({ kind: "save", id: editing, values: parsed.data })) reset();
            }}
          >
            <label className="space-y-1 text-sm">
              Aplicativo
              <Input
                required
                maxLength={100}
                list="challenge-apps"
                value={form.app_name}
                onChange={(e) => change("app_name", e.target.value)}
              />
            </label>
            <datalist id="challenge-apps">
              {appNames.map((app) => (
                <option key={app} value={app} />
              ))}
            </datalist>
            <label className="space-y-1 text-sm">
              Descrição do desafio
              <Input
                required
                maxLength={200}
                value={form.title}
                onChange={(e) => change("title", e.target.value)}
                placeholder="Ex.: Complete 30 entregas"
              />
            </label>
            <label className="space-y-1 text-sm">
              Tipo de meta
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3"
                value={form.metric}
                onChange={(e) => change("metric", e.target.value)}
              >
                <option value="deliveries">Quantidade de entregas</option>
                <option value="revenue">Receita de entregas (R$)</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              Início
              <Input
                required
                type="date"
                value={form.start}
                onChange={(e) => change("start", e.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              Fim (inclusive)
              <Input
                required
                type="date"
                min={form.start}
                value={form.end}
                onChange={(e) => change("end", e.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              {form.metric === "deliveries" ? "Quantidade necessária" : "Receita necessária (R$)"}
              <Input
                required
                inputMode="decimal"
                value={form.target}
                onChange={(e) => change("target", e.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              Bonificação prevista (R$)
              <Input
                required
                inputMode="decimal"
                value={form.reward}
                onChange={(e) => change("reward", e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.auto_receive}
                onChange={(e) => setForm((f) => ({ ...f, auto_receive: e.target.checked }))}
              />
              Creditar automaticamente ao atingir a meta
            </label>
            <div className="flex items-end gap-2">
              <Button disabled={mutation.isPending || challenges.isPending} type="submit">
                {mutation.isPending
                  ? "Salvando…"
                  : editing
                    ? "Salvar alteração"
                    : "Cadastrar desafio"}
              </Button>
              {editing && (
                <Button variant="outline" type="button" onClick={reset}>
                  Cancelar
                </Button>
              )}
            </div>
          </form>
          <p className="my-3 text-xs text-muted-foreground">
            O progresso usa o aplicativo e as datas das entregas concluídas, incluindo gratificações
            do cliente em metas de receita. Regras adicionais da plataforma (aceitação, região,
            horário) devem ser conferidas no aplicativo de origem. Cadastre somente bonificações que
            ainda não estejam incluídas no valor das entregas. O crédito automático é registrado na
            data da validação pelo servidor, após sincronizar as entregas. Ele não confirma um
            pagamento realizado pelo aplicativo. Desmarque a automação para confirmar manualmente.
          </p>
          {challenges.isPending ? (
            <p role="status">Carregando desafios…</p>
          ) : !(challenges.data ?? []).length ? (
            <EmptyState>Nenhum desafio cadastrado.</EmptyState>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {(challenges.data ?? []).map((c) => {
                const progress = challengeProgress(
                  c,
                  deliveriesByApp.get(normalizedApp(c.app_name)) ?? [],
                  now,
                );
                return (
                  <article key={c.id} className="rounded-lg border border-border p-4">
                    <div className="flex justify-between gap-3">
                      <h3 className="font-semibold">{c.title}</h3>
                      <span className="text-sm font-medium">{progress.status}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {c.app_name} · {dateTimeLabel(c.starts_at)} a {dateTimeLabel(c.ends_at)}
                    </p>
                    <p className="my-2 text-sm">
                      {c.metric === "deliveries"
                        ? `${progress.value} / ${c.target} entregas`
                        : `${brl(progress.value)} / ${brl(Number(c.target))}`}{" "}
                      · {num(progress.percent, 0)}%
                    </p>
                    <Progress value={progress.percent} aria-label={`Progresso de ${c.title}`} />
                    <p className="mt-2 text-xs text-muted-foreground">
                      {c.auto_receive ? "Crédito automático ativado" : "Recebimento manual"}
                    </p>
                    <p className="mt-3 text-sm">
                      Bonificação: <strong>{brl(Number(c.reward))}</strong>
                      {c.received_at
                        ? ` · creditada em ${dateTimeLabel(c.received_at)}`
                        : " · ainda não incluída na receita"}
                    </p>
                    {c.auto_receive && !c.received_at && progress.achieved && (
                      <p role="status" className="mt-2 text-sm text-muted-foreground">
                        Meta atingida. Aguardando validação do crédito pelo servidor.
                      </p>
                    )}
                    {deliveries.isPending && <p role="status">Atualizando progresso…</p>}
                    {deliveries.isError && (
                      <p role="alert" className="mt-2 text-sm text-destructive">
                        Não foi possível atualizar as entregas. Confira o progresso antes de
                        receber.
                      </p>
                    )}
                    <div className="no-print mt-3 flex flex-wrap items-end gap-2">
                      {c.received_at ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={mutation.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                "Estornar o recebimento? O valor será retirado da receita, mantendo o desafio e desativando seu crédito automático.",
                              )
                            )
                              void run({ kind: "reverse", challenge: c });
                          }}
                        >
                          Estornar recebimento
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={mutation.isPending}
                            onClick={() => edit(c)}
                          >
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={mutation.isPending}
                            onClick={() => {
                              if (window.confirm("Excluir este desafio sem recebimento?"))
                                void run({ kind: "delete", id: c.id });
                            }}
                          >
                            Excluir
                          </Button>
                          {progress.achieved && !c.auto_receive && (
                            <>
                              <label className="text-xs">
                                Recebido em
                                <Input
                                  aria-label={`Data de recebimento de ${c.title}`}
                                  type="datetime-local"
                                  value={receipt}
                                  min={localDateTime(new Date(c.starts_at))}
                                  max={localDateTime(new Date())}
                                  onChange={(e) => setReceipt(e.target.value)}
                                />
                              </label>
                              <Button
                                size="sm"
                                disabled={
                                  mutation.isPending ||
                                  deliveries.isPending ||
                                  deliveries.isFetching ||
                                  deliveries.isError ||
                                  !receipt
                                }
                                onClick={() => {
                                  if (
                                    receipt &&
                                    window.confirm(
                                      "Confirma que esta bonificação foi recebida e não está incluída nas entregas?",
                                    )
                                  )
                                    void run({
                                      kind: "receive",
                                      challenge: c,
                                      at: new Date(receipt).toISOString(),
                                    });
                                }}
                              >
                                Confirmar recebimento
                              </Button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}
