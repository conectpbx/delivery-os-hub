import { Truck } from "lucide-react";
import { cn } from "@/lib/utils";

/** Spinner com a identidade do Delivery OS (anel em gradiente + ícone). */
export function BrandSpinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Carregando"
      className={cn("relative inline-flex size-12 items-center justify-center", className)}
    >
      <span
        className="absolute inset-0 animate-spin rounded-full brand-gradient"
        style={{ maskImage: "radial-gradient(farthest-side, transparent 62%, #000 64%)", WebkitMaskImage: "radial-gradient(farthest-side, transparent 62%, #000 64%)", clipPath: "polygon(50% 50%, 50% 0, 100% 0, 100% 100%, 50% 100%)" }}
      />
      <span className="absolute inset-0 rounded-full border-2 border-border/60" />
      <Truck className="size-5 animate-pulse text-primary" />
    </span>
  );
}

export function BrandLoading({ label = "Carregando…" }: { label?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <BrandSpinner />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
