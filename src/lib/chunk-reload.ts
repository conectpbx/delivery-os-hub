// Recovers from stale page code after an app update/server restart:
// reload at most once per minute, only after the current document is reachable.
const KEY = "deliveryos.chunk-reload";
const MAX_ATTEMPTS = 1;
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
    return Array.isArray(list)
      ? list.filter((t) => typeof t === "number" && t <= Date.now() && Date.now() - t < WINDOW_MS)
      : [];
  } catch {
    return [];
  }
}

export async function waitForServer(url: string): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    if (!navigator.onLine) return false;
    try {
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(4000) });
      if (res.ok && res.headers.get("content-type")?.includes("text/html")) return true;
    } catch {
      /* A temporary outage must not trigger a document reload. */
    }
    if (i < 2) await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return false;
}

/** Returns true when a reload was scheduled (caller should not report the error). */
export function recoverFromChunkError(error: unknown): boolean {
  if (typeof window === "undefined" || !isChunkError(error)) return false;
  if (recovering) return true;
  const attempts = readAttempts();
  if (attempts.length >= MAX_ATTEMPTS) return false;
  recovering = true;
  // A removed hashed chunk will never return after a deployment. Probe the
  // current document instead, and never fetch an arbitrary URL from an error.
  void waitForServer(window.location.href).then((available) => {
    if (!available) {
      recovering = false;
      return;
    }
    try {
      sessionStorage.setItem(KEY, JSON.stringify([...attempts, Date.now()]));
    } catch {
      /* Recovery also works when storage is unavailable. */
    }
    window.location.reload();
  });
  return true;
}

export function installChunkReloadRecovery() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("vite:preloadError", (e) => {
    const err =
      (e as Event & { payload?: unknown }).payload ?? "Failed to fetch dynamically imported module";
    if (recoverFromChunkError(err)) e.preventDefault();
  });
  window.addEventListener("unhandledrejection", (e) => {
    if (recoverFromChunkError(e.reason)) e.preventDefault();
  });
  window.addEventListener("error", (e) => {
    recoverFromChunkError(e.message);
  });
}
