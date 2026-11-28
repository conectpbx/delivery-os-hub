// @refresh reset
import { StatCard } from "./ui-kit";
import { minutesLabel } from "@/lib/format";
import { useOperationTime } from "@/lib/use-operation-time";

type TimeResult = ReturnType<typeof useOperationTime>;
export function OperationTimeStats({
  from,
  to,
  time,
}: {
  from: Date;
  to: Date;
  time?: TimeResult;
}) {
  return time ? <TimeStats time={time} /> : <LoadTimeStats from={from} to={to} />;
}
function LoadTimeStats({ from, to }: { from: Date; to: Date }) {
  const time = useOperationTime(from, to);
  return <TimeStats time={time} />;
}
function TimeStats({ time }: { time: TimeResult }) {
  const status = time.isPending ? "Carregando…" : time.isError ? "Indisponível" : null;
  return (
    <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        label="Jornada registrada"
        value={status ?? (time.hasJourney ? minutesLabel(time.journeyMin) : "—")}
      />
      <StatCard label="Tempo em entregas/rotas" value={status ?? minutesLabel(time.deliveryMin)} />
      <StatCard
        label="Tempo fora das entregas"
        value={status ?? minutesLabel(time.unassignedMin)}
        hint={
          time.hasJourney
            ? time.openDeliveryCount
              ? `${time.openDeliveryCount} entrega(s) ainda em rota; esse tempo conta como entrega, sem as pausas.`
              : "Espera e deslocamentos, sem as pausas registradas"
            : "Espera informada nos registros"
        }
      />
      <StatCard
        label="Pausas registradas"
        value={status ?? minutesLabel(time.pauseMin)}
        tone="warning"
      />
    </div>
  );
}
