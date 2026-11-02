import { Bike, Car, Footprints, Motorbike, Scooter, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

function normalizeVehicle(vehicle?: string | null) {
  return vehicle
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

/** Retorna o ícone mais próximo do veículo informado no perfil do entregador. */
export function vehicleLoadingIcon(vehicle?: string | null): LucideIcon {
  const normalizedVehicle = normalizeVehicle(vehicle) ?? "";

  if (/moto|motocicl|motorbike/.test(normalizedVehicle)) return Motorbike;
  if (/scooter|patinete/.test(normalizedVehicle)) return Scooter;
  if (/bicic|bike|cicl/.test(normalizedVehicle)) return Bike;
  if (/carro|automovel|veiculo leve/.test(normalizedVehicle)) return Car;
  if (/a pe|pedestre|caminhando/.test(normalizedVehicle)) return Footprints;

  return Motorbike;
}

/** Spinner com a identidade do Delivery OS (anel em gradiente + ícone). */
export function BrandSpinner({
  className,
  vehicle,
}: {
  className?: string;
  vehicle?: string | null | undefined;
}) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const VehicleIcon = vehicleLoadingIcon(hydrated ? vehicle : null);

  return (
    <span
      role="status"
      aria-label="Carregando"
      className={cn("relative inline-flex size-12 items-center justify-center", className)}
    >
      <span
        className="absolute inset-0 animate-spin motion-reduce:animate-none rounded-full brand-gradient"
        style={{
          maskImage: "radial-gradient(farthest-side, transparent 62%, #000 64%)",
          WebkitMaskImage: "radial-gradient(farthest-side, transparent 62%, #000 64%)",
          clipPath: "polygon(50% 50%, 50% 0, 100% 0, 100% 100%, 50% 100%)",
        }}
      />
      <span className="absolute inset-0 rounded-full border-2 border-border/60" />
      <VehicleIcon className="size-5 animate-pulse motion-reduce:animate-none text-primary" />
    </span>
  );
}

export function BrandLoading({
  label = "Carregando…",
  vehicle,
}: {
  label?: string;
  vehicle?: string | null | undefined;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <BrandSpinner vehicle={vehicle} />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
