// @refresh reset
import { StatCard } from "./ui-kit";
import { minutesLabel } from "@/lib/format";
import { useOperationTime } from "@/lib/use-operation-time";

export function OperationTimeStats({ from, to }: { from: Date; to: Date }) {
  const time = useOperationTime(from, to);
  return (
    <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
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
            ? "Espera e deslocamentos, sem as pausas registradas"
            : "Espera informada nos registros"
        }
      />
      <StatCard label="Pausas registradas" value={minutesLabel(time.pauseMin)} tone="warning" />
    </div>
  );
}
