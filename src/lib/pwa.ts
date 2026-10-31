const SW_URL = "/sw.js";

function isPreviewHost(hostname: string): boolean {
  return (
    hostname.startsWith("id-preview--") ||
    hostname.startsWith("preview--") ||
    hostname === "lovableproject.com" ||
    hostname.endsWith(".lovableproject.com") ||
    hostname === "lovableproject-dev.com" ||
    hostname.endsWith(".lovableproject-dev.com") ||
    hostname === "beta.lovable.dev" ||
    hostname.endsWith(".beta.lovable.dev")
  );
}

async function unregisterAppServiceWorkers() {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.allSettled(
    registrations
      .filter((r) => (r.active?.scriptURL ?? r.installing?.scriptURL ?? "").endsWith(SW_URL))
      .map((r) => r.unregister()),
  );
}

export async function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  const refused =
    !import.meta.env.PROD ||
    window.self !== window.top ||
    isPreviewHost(window.location.hostname) ||
    new URLSearchParams(window.location.search).get("sw") === "off";

  if (refused) {
    await unregisterAppServiceWorkers();
    return;
  }

  try {
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    const registration = await navigator.serviceWorker.register(SW_URL, {
      scope: "/",
      updateViaCache: "none",
    });
    await registration.update();
  } catch (error) {
    console.error("[pwa] service worker registration failed", error);
  }
}

export type AppInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let pendingInstallPrompt: AppInstallPrompt | null = null;
export const getInstallPrompt = () => pendingInstallPrompt;

/** Capture before authentication finishes so the install action stays available in the shell. */
export function captureInstallPrompt() {
  const capture = (event: Event) => {
    event.preventDefault();
    pendingInstallPrompt = event as AppInstallPrompt;
    window.dispatchEvent(new Event("deliveryos:install-available"));
  };
  const clear = () => {
    pendingInstallPrompt = null;
  };
  window.addEventListener("beforeinstallprompt", capture);
  window.addEventListener("appinstalled", clear);
  return () => {
    window.removeEventListener("beforeinstallprompt", capture);
    window.removeEventListener("appinstalled", clear);
  };
}

export function consumeInstallPrompt() {
  const event = pendingInstallPrompt;
  pendingInstallPrompt = null;
  return event;
}
