import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { Loader2, ScanLine, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { EmptyState, SectionCard } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { scanFuelReceipt, type ScanResult } from "@/lib/ai.functions";
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
    ],
  }),
  component: Scanner;
});

function Scanner() {
  const scan = useServerFn(scanFuelReceipt);
  const addFuel = useInsert("fuelings", "fuelings");
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [form, setForm] = useState({ liters: "", price_per_liter: "", total: "", station: "" });

  async function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result);
      setPreview(dataUrl);
      setLoading(true);
      try {
        const res = await scan({
          data: { imageBase64: dataUrl.split(",")[1] ?? "", mimeType: file.type || "image/jpeg" },
        });
        setResult(res);
        setForm({
          liters: res.liters ? String(res.liters) : "",
          price_per_liter: res.pricePerLiter ? String(res.pricePerLiter) : "",
          total: res.total ? String(res.total) : "",
          station: res.station ?? "",
        });
        toast.success("Cupom lido pela IA");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao ler o cupom");
      } finally {
        setLoading(false);
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <AppShell title="Scanner IA" subtitle="Leitura automática de cupons de abastecimento">
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Enviar cupom" description="Tire a foto ou selecione uma imagem do cupom fiscal">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
            className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border p-10 text-center transition-colors hover:border-primary/50 hover:bg-accent/40"
          >
            {loading ? (
              <Loader2 className="size-8 animate-spin text-primary" />
            ) : (
              <Upload className="size-8 text-muted-foreground" />
            )}
            <p className="text-sm font-medium">
              {loading ? "Analisando o cupom..." : "Toque para enviar o cupom"}
            </p>
            <p className="text-xs text-muted-foreground">JPG ou PNG · a IA extrai litros, preço e total</p>
          </div>

          {preview ? (
            <img
              src={preview}
              alt="Prévia do cupom de abastecimento enviado"
              className="mt-4 max-h-64 w-full rounded-xl object-contain"
            />
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
                  <Input value={form.liters} onChange={(e) => setForm({ ...form, liters: e.target.value })} />
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
                  <Input value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Posto</Label>
                  <Input value={form.station} onChange={(e) => setForm({ ...form, station: e.target.value })} />
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
