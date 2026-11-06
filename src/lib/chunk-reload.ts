// Recovers from stale page code after an app update/server restart:
// a failed dynamic import waits until the server answers again, then reloads
// (up to 3 attempts per minute) instead of leaving a blank screen.
const KEY = "deliveryos.chunk-reload";
const MAX_ATTEMPTS = 3;
const WINDOW_MS = 60_000;
let installed = false;
let recovering = false;

export function isChunkError(msg: unknown) {
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(
    String((msg as Error)?.message ?? msg ?? ""),
  );
}

function readAttempts(): number[] {
  try {
    const list = JSON.parse(sessionStorage.getItem(KEY) || "[]") as number[];
    return list.filter((t) => Date.now() - t < WINDOW_MS);
  } catch {
    return [];
  }
}

async function waitForServer(url: string) {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/** Returns true when a reload was scheduled (caller should not report the error). */
export function recoverFromChunkError(error: unknown): boolean {
  if (typeof window === "undefined" || !isChunkError(error)) return false;
  if (recovering) return true;
  const attempts = readAttempts();
  if (attempts.length >= MAX_ATTEMPTS) return false;
  recovering = true;
  try {
    sessionStorage.setItem(KEY, JSON.stringify([...attempts, Date.now()]));
  } catch {}
  const match = String((error as Error)?.message ?? error).match(/https?:\/\/\S+|\/src\/\S+/);
  const probe = match?.[0] ?? window.location.href;
  void waitForServer(probe).finally(() => window.location.reload());
  return true;
}

export function installChunkReloadRecovery() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("vite:preloadError", (e) => {
    const err = (e as Event & { payload?: unknown }).payload ?? "Failed to fetch dynamically imported module";
    if (recoverFromChunkError(err)) e.preventDefault();
  });
  window.addEventListener("unhandledrejection", (e) => {
    if (recoverFromChunkError(e.reason)) e.preventDefault();
  });
  window.addEventListener("error", (e) => {
    recoverFromChunkError(e.message);
  });
}
