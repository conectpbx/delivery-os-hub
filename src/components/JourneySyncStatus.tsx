import { Button } from "./ui/button";

export function JourneySyncStatus({ error, retry }: { error: string | null; retry: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" className="my-3 flex flex-wrap items-center gap-2 text-sm text-destructive">
      <span>{error}</span>
      <Button type="button" size="sm" variant="outline" onClick={retry}>
        Tentar sincronizar
      </Button>
    </div>
  );
}
