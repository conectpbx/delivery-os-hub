import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { scanRideScreenshot, type RideScanResult } from "@/lib/ai.functions";

const TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Lê o print da corrida com IA, só após o usuário escolher a imagem. */
export function RideScanButton({
  apps,
  onResult,
}: {
  apps: string[];
  onResult: (r: RideScanResult) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const scan = useServerFn(scanRideScreenshot);

  async function handle(file: File) {
    const mimeType = TYPES.find((t) => t === file.type);
    if (!mimeType) return toast.error("Use uma imagem JPG, PNG ou WEBP.");
    if (file.size > 5_500_000) return toast.error("Imagem muito grande (máx. 5 MB).");
    setBusy(true);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const r = await scan({ data: { imageBase64: btoa(bin), mimeType } });
      const match = r.app ? apps.find((a) => a.toLowerCase().includes(r.app!.toLowerCase()) || r.app!.toLowerCase().includes(a.toLowerCase())) : undefined;
      onResult({ ...r, app: match ?? null });
      toast.success(`Print lido — confira os valores. ${r.remaining} leituras restantes hoje.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível ler o print.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handle(f);
        }}
      />
      <Button
        type="button"
        variant="outline"
        className="h-10 w-full gap-2"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <ScanLine className="size-4" />}
        {busy ? "Lendo print…" : "Preencher pelo print da corrida (IA)"}
      </Button>
    </>
  );
}
