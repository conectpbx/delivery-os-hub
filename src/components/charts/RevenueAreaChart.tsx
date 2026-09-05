import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { brl } from "@/lib/format";

type Point = { day: string; receita: number; lucro: number };

type TooltipPayload = {
  color?: string;
  dataKey?: string | number;
  value?: number | string;
};

function CompactCurrency(value: number) {
  if (Math.abs(value) >= 1_000) {
    return `R$ ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value / 1_000)} mil`;
  }
  return `R$ ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value)}`;
}

function ChartTooltip({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string;
  payload?: TooltipPayload[];
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

export default function RevenueAreaChart({ data }: { data: Point[] }) {
  const gradientId = useId().replaceAll(":", "");

  return (
    <div
      className="flex size-full min-h-0 flex-col"
      role="img"
      aria-label="Gráfico de receita e lucro real por dia"
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-chart-1 shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-chart-1)_14%,transparent)]" />
          Receita
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-chart-2 shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-chart-2)_14%,transparent)]" />
          Lucro real
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ left: 0, right: 6, top: 10, bottom: 0 }}>
            <defs>
              <linearGradient id={`${gradientId}-revenue`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.34} />
                <stop offset="70%" stopColor="var(--color-chart-1)" stopOpacity={0.07} />
                <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id={`${gradientId}-profit`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-chart-2)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--color-chart-2)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 7" vertical={false} />
            <XAxis
              dataKey="day"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
              minTickGap={24}
              dy={10}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }}
              tickFormatter={CompactCurrency}
              width={72}
              tickMargin={8}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{
                stroke: "var(--color-muted-foreground)",
                strokeDasharray: "3 5",
                strokeOpacity: 0.45,
              }}
            />
            <Area
              type="monotone"
              dataKey="receita"
              stroke="var(--color-chart-1)"
              fill={`url(#${gradientId}-revenue)`}
              strokeWidth={2.5}
              activeDot={{ r: 5, strokeWidth: 3, stroke: "var(--color-card)" }}
            />
            <Area
              type="monotone"
              dataKey="lucro"
              stroke="var(--color-chart-2)"
              fill={`url(#${gradientId}-profit)`}
              strokeWidth={2.5}
              activeDot={{ r: 5, strokeWidth: 3, stroke: "var(--color-card)" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
