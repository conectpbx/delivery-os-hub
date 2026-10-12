import { StatCard } from "./ui-kit";
import { minutesLabel } from "@/lib/format";
import { useOperationTime } from "@/lib/use-operation-time";

export function OperationTimeStats({ from, to }: { from: Date; to: Date }) {
  const time = useOperationTime(from, to);
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      <StatCard
        label="Jornada registrada"
        value={time.hasJourney ? minutesLabel(time.journeyMin) : "—"}
      />
      <StatCard label="Tempo em entregas/rotas" value={minutesLabel(time.deliveryMin)} />
      <StatCard
        label="Tempo fora das entregas"
        value={minutesLabel(time.unassignedMin)}
        hint={
          time.hasJourney
            ? "Espera, pausas e deslocamentos sem entrega"
            : "Espera informada nos registros"
        }
      />
    </div>
  );
}
