import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BrandLoading, BrandSpinner } from "./BrandLoader";

test("usa moto antes do perfil e respeita o carro cadastrado", () => {
  assert.ok(renderToStaticMarkup(<BrandSpinner />).includes("lucide-motorbike"));
  assert.ok(renderToStaticMarkup(<BrandSpinner vehicle="Carro" />).includes("lucide-car"));
  assert.ok(
    renderToStaticMarkup(<BrandSpinner vehicle="Motocicleta" />).includes("lucide-motorbike"),
  );
});

test("carregamento tem status acessível, mensagem e suporte a movimento reduzido", () => {
  const html = renderToStaticMarkup(<BrandLoading label="Abrindo tela…" vehicle="Carro" />);
  for (const value of [
    'role="status"',
    'aria-label="Carregando"',
    "Abrindo tela…",
    "motion-reduce:animate-none",
  ])
    assert.ok(html.includes(value), value);
});
