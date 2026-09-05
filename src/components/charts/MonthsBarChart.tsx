import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { brl } from "@/lib/format";

type Point = { mes: string; receita: number; lucro: number };
type TooltipItem = { color?: string; dataKey?: string | number; value?: number | string };

const compactCurrency = (value: number) =>
  Math.abs(value) >= 1_000
    ? `R$ ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value / 1_000)} mil`
    : `R$ ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value)}`;

function ChartTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string;
  payload?: TooltipItem[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-44 rounded-2xl border border-border/70 bg-popover/95 p-3 shadow-xl backdrop-blur-md">
      <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <div className="space-y-2">
        {payload.map((item) => (
          <div key={item.dataKey} className="flex items-center justify-between gap-5 text-xs">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />
              {item.dataKey === "receita" ? "Receita" : "Lucro real"}
            </span>
            <strong className="font-semibold tabular-nums text-popover-foreground">
              {brl(Number(item.value ?? 0))}
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MonthsBarChart({ data }: { data: Point[] }) {
  return (
    <div
      className="flex size-full min-h-0 flex-col"
      role="img"
      aria-label="Gráfico comparativo de receita e lucro real por mês"
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-chart-1" />
          Receita
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-chart-2" />
          Lucro real
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: 0, right: 6, top: 8, bottom: 0 }} barGap={4}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 7" vertical={false} />
            <XAxis
              dataKey="mes"
              tickLine={false}
              axisLine={false}
              minTickGap={18}
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
              dy={10}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }}
              tickFormatter={compactCurrency}
              width={72}
              tickMargin={8}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ fill: "var(--color-muted)", opacity: 0.55, radius: 8 }}
            />
            <Bar
              dataKey="receita"
              fill="var(--color-chart-1)"
              radius={[7, 7, 2, 2]}
              maxBarSize={38}
            />
            <Bar
              dataKey="lucro"
              fill="var(--color-chart-2)"
              radius={[7, 7, 2, 2]}
              maxBarSize={38}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
