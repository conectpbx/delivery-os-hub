import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { BonusIncome } from "./BonusIncome";
import { AppChallenges } from "./AppChallenges";
import type { AppChallenge } from "@/lib/app-challenges";

const c: AppChallenge = {
  id: "c",
  title: "Desafio recebido",
  app_name: "iFood",
  starts_at: "2026-10-20T00:00:00Z",
  ends_at: "2026-10-21T23:59:59Z",
  received_at: "2026-11-01T12:00:00Z",
  target: 10,
  metric: "deliveries",
  reward: 50,
};
function render(rows: AppChallenge[], component: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["app_challenges"], rows);
  client.setQueryData(["deliveries"], []);
  client.setQueryData(["apps"], []);
  try {
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>{component}</QueryClientProvider>,
    );
  } finally {
    client.clear();
  }
}

test("composição mostra recibo no mês de pagamento e exclui conquistas sem recebimento", () => {
  const html = render(
    [c, { ...c, id: "pending", title: "Ainda não pago", received_at: null }],
    <BonusIncome
      from={new Date("2026-11-01T00:00:00Z")}
      to={new Date("2026-11-30T23:59:59Z")}
      deliveryRevenue={100}
    />,
  );
  assert.ok(html.includes("Desafio recebido"));
  assert.ok(!html.includes("Ainda não pago"));
  assert.ok(html.includes("150,00"));
  assert.ok(html.includes("Bonificações creditadas"));
});

test("recebimento de novembro não aparece na composição de outubro", () => {
  const html = render(
    [c],
    <BonusIncome
      from={new Date("2026-10-01T00:00:00Z")}
      to={new Date("2026-10-31T23:59:59Z")}
      deliveryRevenue={100}
    />,
  );
  assert.ok(html.includes("Nenhuma bonificação creditada neste período"));
  assert.ok(!html.includes("Desafio recebido"));
});

test("desafio recebido permite estorno e bloqueia edição e exclusão direta", () => {
  const html = render([c], <AppChallenges />);
  assert.ok(html.includes("Estornar recebimento"));
  assert.ok(!html.includes(">Editar<"));
  assert.ok(!html.includes(">Excluir<"));
  assert.ok(!html.includes("Confirmar recebimento"));
});

test("automação explica crédito na receita e oferece controle acessível", () => {
  const html = render([{ ...c, auto_receive: true }], <AppChallenges />);
  assert.ok(html.includes("Creditar automaticamente ao atingir a meta"));
  assert.ok(html.includes('type="checkbox"'));
  assert.ok(html.includes("Crédito automático ativado"));
  assert.ok(html.includes("não confirma um pagamento realizado pelo aplicativo"));
});
