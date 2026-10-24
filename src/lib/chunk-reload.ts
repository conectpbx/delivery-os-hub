// Recovers from stale page code after an app update/server restart:
// a failed dynamic import reloads the page once instead of blanking the screen.
const KEY = "deliveryos.chunk-reload-at";
let installed = false;

function isChunkError(msg: string) {
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(msg);
}

function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 10_000) return;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {}
  window.location.reload();
}

export function installChunkReloadRecovery() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("vite:preloadError", (e) => {
    e.preventDefault();
    reloadOnce();
  });
  window.addEventListener("unhandledrejection", (e) => {
    const msg = String((e.reason as Error)?.message ?? e.reason ?? "");
    if (isChunkError(msg)) reloadOnce();
  });
  window.addEventListener("error", (e) => {
    if (isChunkError(String(e.message ?? ""))) reloadOnce();
  });
}
