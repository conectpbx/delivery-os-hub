import { Button } from "@/components/ui/button";
import type { TripState } from "@/lib/trip-tracker";

export function GpsTrackingStatus({
  trip,
  error,
  onRetry,
}: {
  trip: TripState;
  error: string | null;
  onRetry: () => void;
}) {
  const paused = trip.pauses?.some((pause) => !pause.ended_at);
  return (
    <>
      {trip.active ? (
        <p role="status" className="w-full text-xs text-muted-foreground">
          {paused
            ? "Captura GPS pausada."
            : trip.source === "external"
              ? "GPS integrado selecionado. A troca para o GPS deste dispositivo é automática se a integração parar de responder."
              : `${trip.preferredGps === "external" ? "Integração GPS sem leitura recente. " : ""}GPS deste dispositivo selecionado. Permita a localização e mantenha o app aberto; no iPhone, a captura pode parar com a tela bloqueada.`}
        </p>
      ) : null}
      {error ? (
        <p role="status" className="w-full text-xs text-warning">
          {error}
        </p>
      ) : null}
      {error && trip.active && trip.source === "browser" && !paused ? (
        <Button variant="outline" className="min-h-11" onClick={onRetry}>
          Tentar ativar GPS deste dispositivo
        </Button>
      ) : null}
    </>
  );
}
