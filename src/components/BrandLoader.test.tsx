import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Bike, Car, Footprints, Motorbike, Scooter } from "lucide-react";
import { BrandLoading, vehicleLoadingIcon } from "./BrandLoader";

test("usa moto antes do perfil e respeita o carro cadastrado", () => {
  assert.equal(vehicleLoadingIcon(), Motorbike);
  assert.equal(vehicleLoadingIcon("Carro"), Car);
  assert.equal(vehicleLoadingIcon("Motocicleta"), Motorbike);
  assert.equal(vehicleLoadingIcon("Bicicleta"), Bike);
  assert.equal(vehicleLoadingIcon("Patinete"), Scooter);
  assert.equal(vehicleLoadingIcon("A pé"), Footprints);
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
