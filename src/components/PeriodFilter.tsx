import { useMemo, useState } from "react";
import { CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PERIODS, periodRange, type Period } from "@/lib/metrics";
import { useCalendarNow } from "@/hooks/useCalendarNow";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};

const startOf = (s: string) => {
  const d = parse(s);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOf = (s: string) => {
  const d = parse(s);
  d.setHours(23, 59, 59, 999);
  return d;
};

const prettyDate = (s: string) => parse(s).toLocaleDateString("pt-BR");

function presetDates(p: Period, now = new Date()) {
  const { from, to } = periodRange(p, now);
  const start = p.mode === "all" ? new Date(2020, 0, 1) : from;
  return { from: iso(start), to: iso(to) };
}

export type PeriodSelection = {
  key: string;
  label: string;
  from: string;
  to: string;
  fromDate: Date;
  toDate: Date;
  setPreset: (p: Period) => void;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
};

export function usePeriodSelection(defaultIndex = 3): PeriodSelection {
  const initial = PERIODS[defaultIndex] ?? PERIODS[3]!;
  const now = useCalendarNow();
  const [state, setState] = useState(() => ({
    key: initial.key as string,
    customDates: presetDates(initial),
  }));

  return useMemo(() => {
    const preset = PERIODS.find((p) => p.key === state.key);
    const dates = preset ? presetDates(preset, now) : state.customDates;
    const label =
      preset && state.key !== "custom"
        ? preset.label
        : `${prettyDate(dates.from)} — ${prettyDate(dates.to)}`;
    return {
      key: state.key,
      label,
      from: dates.from,
      to: dates.to,
      fromDate: startOf(dates.from),
      toDate: endOf(dates.to),
      setPreset: (p: Period) =>
        setState((s) => ({ ...s, key: p.key, customDates: presetDates(p) })),
      setFrom: (v: string) =>
        setState((s) => ({
          key: "custom",
          customDates: { ...dates, from: v || dates.from },
        })),
      setTo: (v: string) =>
        setState((s) => ({
          key: "custom",
          customDates: { ...dates, to: v || dates.to },
        })),
    };
  }, [now, state]);
}

export function PeriodFilter({ selection }: { selection: PeriodSelection }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
        {PERIODS.map((p) => (
          <Button
            key={p.key}
            size="sm"
            variant={selection.key === p.key ? "default" : "ghost"}
            className="h-7 px-3 text-xs"
            onClick={() => selection.setPreset(p)}
          >
            {p.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant={selection.key === "custom" ? "default" : "ghost"}
          className="h-7 px-3 text-xs"
          onClick={() => selection.setFrom(selection.from)}
        >
          Personalizado
        </Button>
      </div>
    </div>
  );
}

export function PeriodSummary({ selection }: { selection: PeriodSelection }) {
  return (
    <div className="surface-card mt-4 flex flex-wrap items-end gap-3 p-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <CalendarRange className="size-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Período filtrado
          </p>
          <p className="truncate text-sm font-semibold">
            {prettyDate(selection.from)} até {prettyDate(selection.to)}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              ({selection.key === "custom" ? "personalizado" : selection.label})
            </span>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground">
          Início
          <Input
            type="date"
            value={selection.from}
            max={selection.to}
            onChange={(e) => selection.setFrom(e.target.value)}
            className="mt-1 h-8 w-[10.5rem] text-sm"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Fim
          <Input
            type="date"
            value={selection.to}
            min={selection.from}
            onChange={(e) => selection.setTo(e.target.value)}
            className="mt-1 h-8 w-[10.5rem] text-sm"
          />
        </label>
      </div>
    </div>
  );
}
