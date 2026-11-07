import { memo } from "react";
import type { App, PaymentMethod } from "@/lib/data";
import { brl, dec } from "@/lib/format";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
export const DeliveryQuickForm = memo(function DeliveryQuickForm({
  apps,
  app,
  value,
  net,
  fee,
  payment,
  tip,
  frequent,
  busy,
  select,
  change,
  save,
}: {
  apps: App[];
  app: string;
  value: string;
  net: number;
  fee: number;
  payment: PaymentMethod;
  tip: number;
  frequent: number[];
  busy: boolean;
  select: (app: string) => void;
  change: (value: string) => void;
  save: () => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      className="space-y-4"
    >
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Aplicativo</legend>
        <div className="flex flex-wrap gap-2">
          {apps.map((item) => (
            <Button
              key={item.id}
              type="button"
              className="min-h-12 px-4"
              variant={app === item.name ? "default" : "outline"}
              aria-pressed={app === item.name}
              onClick={() => select(item.name)}
            >
              {item.name}
            </Button>
          ))}
        </div>
        {!apps.length && (
          <p className="text-sm text-muted-foreground">Cadastre seu aplicativo no modo Completo.</p>
        )}
      </fieldset>
      <label className="block space-y-2 text-sm font-medium">
        Valor bruto (R$)
        <Input
          required
          inputMode="decimal"
          autoComplete="off"
          className="h-14 text-2xl"
          value={value}
          onChange={(event) => change(event.target.value)}
          placeholder="0,00"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {[5, 10, 15].map((amount) => (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            key={amount}
            onClick={() => {
              const numeric = dec(value);
              change(
                String(Math.round(((Number.isFinite(numeric) ? numeric : 0) + amount) * 100) / 100),
              );
            }}
          >
            +{brl(amount)}
          </Button>
        ))}
      </div>
      {frequent.length > 0 && (
        <div>
          <p className="mb-2 text-xs text-muted-foreground">Valores recentes deste aplicativo</p>
          <div className="flex flex-wrap gap-2">
            {frequent.map((amount) => (
              <Button
                key={amount}
                type="button"
                variant="secondary"
                className="min-h-11"
                onClick={() => change(String(amount))}
              >
                {brl(amount)}
              </Button>
            ))}
          </div>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        Taxa: {fee}% · Recebimento:{" "}
        {payment === "pix" ? "Pix" : payment === "dinheiro" ? "Dinheiro" : "Crédito"}
      </p>
      <p className="text-lg font-semibold">Líquido: {brl(net)}</p>
      {tip > 0 && (
        <p className="text-xs text-muted-foreground">
          Inclui {brl(tip)} de gratificação informada.
        </p>
      )}
      <Button type="submit" className="min-h-14 w-full text-base" disabled={busy || !app}>
        {busy ? "Salvando…" : "Registrar entrega concluída"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Data e hora atuais. Confira os padrões acima; altere taxas e pagamento no modo Completo. GPS
        e percurso são opcionais.
      </p>
    </form>
  );
});
