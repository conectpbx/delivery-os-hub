import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { authStore, useAuth } from "@/hooks/useAuth";
import { scanDeliveryReceipt } from "@/lib/ai.functions";
import type { DeliveryScan, DeliveryScanResult } from "@/lib/delivery-scan";
import { reviewedDeliveryFee } from "@/lib/delivery-scan";
import { dec } from "@/lib/format";
import { prepareScanImage } from "@/lib/scan-image";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";

export function DeliveryOcr({ apply }: { apply: (scan: DeliveryScan) => void }) {
  const { user } = useAuth();
  const scan = useServerFn(scanDeliveryReceipt);
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const [image, setImage] = useState<string | null>(null);
  const [result, setResult] = useState<DeliveryScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState({
    appName: "",
    gross: "",
    tip: "",
    distanceKm: "",
    durationMin: "",
    feeAmount: "",
    feePercent: "",
    pickupAddress: "",
    dropoffAddress: "",
  });
  useEffect(() => {
    const counter = generation;
    counter.current++;
    setImage(null);
    setResult(null);
    setBusy(false);
    return () => {
      counter.current++;
    };
  }, [user?.id]);
  async function select(file: File) {
    const version = ++generation.current;
    setBusy(true);
    setResult(null);
    try {
      const image = await prepareScanImage(file);
      if (version === generation.current) setImage(image);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível abrir a imagem");
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }
  async function read() {
    if (!image || busy) return;
    const version = generation.current;
    const owner = user?.id;
    setBusy(true);
    try {
      const result = await scan({
        data: { imageBase64: image.split(",")[1]!, mimeType: "image/jpeg" },
      });
      if (version !== generation.current || authStore.getSnapshot().session?.user.id !== owner)
        return;
      setResult(result);
      setFields({
        appName: result.appName ?? "",
        gross: result.gross == null ? "" : String(result.gross),
        tip: result.tip == null ? "" : String(result.tip),
        distanceKm: result.distanceKm == null ? "" : String(result.distanceKm),
        durationMin: result.durationMin == null ? "" : String(result.durationMin),
        feeAmount: result.feeAmount == null ? "" : String(result.feeAmount),
        feePercent: result.feePercent == null ? "" : String(result.feePercent),
        pickupAddress: result.pickupAddress ?? "",
        dropoffAddress: result.dropoffAddress ?? "",
      });
    } catch (error) {
      if (version === generation.current)
        toast.error(error instanceof Error ? error.message : "Não foi possível ler o comprovante");
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }
  return (
    <div className="mb-4">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        aria-label="Imagem do comprovante da corrida"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void select(file);
          event.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-full"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? "Preparando leitura…" : "Ler print ou comanda com IA"}
      </Button>
      <Dialog
        open={Boolean(image)}
        onOpenChange={(open) => {
          if (!open) {
            generation.current++;
            setImage(null);
            setResult(null);
            setBusy(false);
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Revisar comprovante da corrida</DialogTitle>
            <DialogDescription>
              A IA pode errar. Revise os dados; aplicar preenche o formulário e não salva a entrega.
              A imagem só é enviada ao tocar em Ler imagem.
            </DialogDescription>
          </DialogHeader>
          {image && (
            <img
              src={image}
              alt="Comprovante selecionado para revisão"
              className="max-h-48 w-full object-contain"
            />
          )}
          {!result ? (
            <Button type="button" className="min-h-12" disabled={busy} onClick={() => void read()}>
              {busy ? "Lendo imagem…" : "Ler imagem"}
            </Button>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                try {
                  const gross = fields.gross.trim() ? dec(fields.gross) : null;
                  const amount = fields.feeAmount.trim() ? dec(fields.feeAmount) : null;
                  const percent = reviewedDeliveryFee(
                    gross ?? 0,
                    amount,
                    fields.feePercent.trim() ? dec(fields.feePercent) : null,
                  );
                  apply({
                    appName: fields.appName.trim() || null,
                    gross,
                    tip: fields.tip.trim() ? dec(fields.tip) : null,
                    distanceKm: fields.distanceKm.trim() ? dec(fields.distanceKm) : null,
                    durationMin: fields.durationMin.trim() ? dec(fields.durationMin) : null,
                    feeAmount: amount,
                    feePercent: percent,
                    pickupAddress: fields.pickupAddress.trim() || null,
                    dropoffAddress: fields.dropoffAddress.trim() || null,
                  });
                  setImage(null);
                  setResult(null);
                  generation.current++;
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Confira os valores");
                }
              }}
            >
              {(
                [
                  ["appName", "Aplicativo"],
                  ["gross", "Valor bruto (R$)"],
                  ["tip", "Gorjeta (R$)"],
                  ["distanceKm", "Distância (km)"],
                  ["durationMin", "Duração (min)"],
                  ["feeAmount", "Taxa em R$"],
                  ["feePercent", "Taxa (%)"],
                  ["pickupAddress", "Coleta"],
                  ["dropoffAddress", "Entrega"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="block space-y-1 text-sm">
                  {label}
                  <Input
                    maxLength={key === "appName" ? 100 : 500}
                    inputMode={
                      [
                        "gross",
                        "tip",
                        "distanceKm",
                        "durationMin",
                        "feeAmount",
                        "feePercent",
                      ].includes(key)
                        ? "decimal"
                        : "text"
                    }
                    value={fields[key]}
                    onChange={(event) =>
                      setFields((old) => ({ ...old, [key]: event.target.value }))
                    }
                    placeholder="Não identificado"
                  />
                </label>
              ))}
              <p className="text-xs text-muted-foreground">
                {result.remaining} leituras restantes na cota compartilhada com o scanner de
                combustível. Campos vazios não substituem dados já digitados.
              </p>
              <Button type="submit" className="min-h-12 w-full">
                Aplicar ao formulário e revisar
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
