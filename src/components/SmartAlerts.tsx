import { useState } from "react";
import { AlertTriangle, Bell, Info, Lightbulb, Sparkles } from "lucide-react";
import type { SmartAlert } from "@/lib/alerts";
import { SectionCard, EmptyState } from "@/components/ui-kit";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TONE = {
  danger: "border-destructive/40 bg-destructive/5 text-destructive",
  warning: "border-warning/40 bg-warning/5 text-warning",
  success: "border-success/40 bg-success/5 text-success",
  info: "border-border bg-muted/40 text-muted-foreground",
} as const;

function Icon({ alert }: { alert: SmartAlert }) {
  const cls = "size-4 shrink-0";
  if (alert.severity === "danger" || alert.severity === "warning")
    return <AlertTriangle className={cls} />;
  if (alert.kind === "motivacional") return <Sparkles className={cls} />;
  if (alert.kind === "dica") return <Lightbulb className={cls} />;
  return <Info className={cls} />;
}

export function SmartAlerts({ alerts }: { alerts: SmartAlert[] }) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const visible = alerts.filter((a) => !dismissed.includes(a.id));
  const shown = expanded ? visible : visible.slice(0, 3);

  return (
    <SectionCard
      title="Alertas inteligentes"
      description="Lembretes, avisos e incentivos com base nos seus dados"
      actions={
        visible.length > 3 ? (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Ver menos" : `Ver todos (${visible.length})`}
          </Button>
        ) : (
          <Bell className="size-4 text-muted-foreground" />
        )
      }
    >
      {shown.length ? (
        <ul className="space-y-2">
          {shown.map((a) => (
            <li
              key={a.id}
              className={cn("flex items-start gap-3 rounded-lg border p-3", TONE[a.severity])}
            >
              <Icon alert={a} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{a.title}</p>
                <p className="text-xs text-muted-foreground">{a.message}</p>
              </div>
              <button
                type="button"
                aria-label="Dispensar alerta"
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setDismissed((d) => [...d, a.id])}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>Tudo em dia. Nenhum alerta no momento. 🎉</EmptyState>
      )}
    </SectionCard>
  );
}
