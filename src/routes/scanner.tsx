import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { Camera, Loader2, ScanLine, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { EmptyState, SectionCard } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DAILY_SCAN_LIMIT, scanFuelReceipt, type ScanResult } from "@/lib/ai.functions";

import { useInsert } from "@/lib/data";
import { brl } from "@/lib/format";

export const Route = createFileRoute("/scanner")({
  head: () => ({
    meta: [
      { title: "Scanner OCR de cupons com IA — Delivery OS" },
      {
        name: "description",
        content:
          "Fotografe o cupom de abastecimento e a inteligência artificial preenche litros, preço e total automaticamente.",
      },
      { property: "og:title", content: "Scanner OCR com IA — Delivery OS" },
      {
        property: "og:description",
        content: "Leitura automática de cupons fiscais de combustível para o entregador.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Scanner,
});

function Scanner() {
  const scan = useServerFn(scanFuelReceipt);
  const addFuel = useInsert("fuelings", "fuelings");
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState<{ base64: string; mimeType: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [form, setForm] = useState({ liters: "", price_per_liter: "", total: "", station: "" });

  function selectFile(file: File) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Formato não aceito. Envie uma imagem JPG, PNG ou WebP.");
      return;
    }
    if (file.size > 6_000_000) {
      toast.error("A imagem deve ter no máximo 6 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      setPreview(dataUrl);
      setResult(null);
      setPending({
        base64: dataUrl.split(",")[1] ?? "",
        mimeType: file.type || "image/jpeg",
      });
    };
    reader.onerror = () => toast.error("Não foi possível abrir esta imagem.");
    reader.readAsDataURL(file);
  }

  async function runScan() {
    if (!pending || loading) return;
    setLoading(true);
    try {
      const res = await scan({
        data: { imageBase64: pending.base64, mimeType: pending.mimeType },
      });
      setResult(res);
      setPending(null);
      setRemaining(res.remaining);
      setForm({
        liters: res.liters ? String(res.liters) : "",
        price_per_liter: res.pricePerLiter ? String(res.pricePerLiter) : "",
        total: res.total ? String(res.total) : "",
        station: res.station ?? "",
      });
      toast.success(`Cupom lido pela IA · ${res.remaining} leituras restantes hoje`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao ler o cupom");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell title="Scanner IA" subtitle="Leitura automática de cupons de abastecimento">
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Enviar cupom"
          description="Você escolhe a imagem e só depois confirma o envio para a IA"
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) selectFile(f);
              e.target.value = "";
            }}
          />
          <input
            ref={cameraRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) selectFile(f);
              e.target.value = "";
            }}
          />

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="flex-1 gap-2"
              onClick={() => cameraRef.current?.click()}
            >
              <Camera className="size-4" /> Tirar foto
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1 gap-2"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="size-4" /> Escolher imagem
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            A câmera só é aberta quando você toca em “Tirar foto”. Nenhuma leitura de IA acontece
            sem sua confirmação. Limite de {DAILY_SCAN_LIMIT} leituras por dia
            {remaining !== null ? ` · ${remaining} restantes hoje` : ""}.
          </p>

          {preview ? (
            <img
              src={preview}
              alt="Prévia do cupom de abastecimento enviado"
              className="mt-4 max-h-64 w-full rounded-xl object-contain"
            />
          ) : null}

          {pending ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Button type="button" className="flex-1 gap-2" disabled={loading} onClick={runScan}>
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ScanLine className="size-4" />
                )}
                {loading ? "Analisando..." : "Analisar com IA"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={loading}
                onClick={() => {
                  setPending(null);
                  setPreview(null);
                  setResult(null);
                }}
              >
                Descartar
              </Button>
            </div>
          ) : null}
        </SectionCard>


        <SectionCard title="Dados extraídos" description="Confira e salve no financeiro">
          {result ? (
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const liters = Number(form.liters || 0);
                const price = Number(form.price_per_liter || 0);
                await addFuel.mutateAsync({
                  liters,
                  price_per_liter: price,
                  total: Number(form.total || liters * price),
                  station: form.station || null,
                });
                toast.success("Abastecimento salvo");
                setResult(null);
                setPreview(null);
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs">Litros</Label>
                  <Input
                    value={form.liters}
                    onChange={(e) => setForm({ ...form, liters: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">R$/litro</Label>
                  <Input
                    value={form.price_per_liter}
                    onChange={(e) => setForm({ ...form, price_per_liter: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Total (R$)</Label>
                  <Input
                    value={form.total}
                    onChange={(e) => setForm({ ...form, total: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Posto</Label>
                  <Input
                    value={form.station}
                    onChange={(e) => setForm({ ...form, station: e.target.value })}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Valor identificado: {form.total ? brl(Number(form.total)) : "não detectado"}
              </p>
              <Button type="submit" className="w-full gap-2">
                <ScanLine className="size-4" /> Salvar abastecimento
              </Button>
            </form>
          ) : (
            <EmptyState>Envie um cupom para a IA preencher os campos.</EmptyState>
          )}
        </SectionCard>
      </div>
    </AppShell>
  );
}
