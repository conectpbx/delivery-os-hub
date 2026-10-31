import { useEffect, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";

import { getInstallPrompt, consumeInstallPrompt, type AppInstallPrompt } from "@/lib/pwa";

export function PwaInstall() {
  const dismissedRef = useRef(false);
  const [prompt, setPrompt] = useState<AppInstallPrompt | null>(null);
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)");
    const fullscreen = window.matchMedia("(display-mode: fullscreen)");
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem("deliveryos.install-dismissed") === "yes";
    } catch {
      /* Storage can be unavailable. */
    }
    dismissedRef.current = dismissed;
    const update = () =>
      setVisible(
        /Android/i.test(navigator.userAgent) &&
          !standalone.matches &&
          !fullscreen.matches &&
          !dismissedRef.current,
      );
    const onPrompt = () => {
      setPrompt(getInstallPrompt());
      update();
    };
    const onInstalled = () => {
      setVisible(false);
      setPrompt(null);
    };
    onPrompt();
    window.addEventListener("deliveryos:install-available", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    standalone.addEventListener("change", update);
    fullscreen.addEventListener("change", update);
    return () => {
      window.removeEventListener("deliveryos:install-available", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      standalone.removeEventListener("change", update);
      fullscreen.removeEventListener("change", update);
    };
  }, []);
  if (!visible) return null;
  return (
    <aside
      aria-label="Instalar Delivery OS"
      className="no-print mb-4 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3 lg:hidden"
    >
      <img src="/icons/icon-192.png" alt="" className="size-10 rounded-lg" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Abra o Delivery OS como aplicativo</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Instale pelo menu do Chrome → Instalar aplicativo. Depois, abra pelo ícone do Delivery OS
          na tela inicial para usar sem a barra do navegador. Se houver um atalho com o símbolo do
          Chrome, instale o aplicativo completo quando essa opção estiver disponível.
        </p>
        {prompt && (
          <Button
            size="sm"
            className="mt-2 gap-2"
            disabled={installing}
            onClick={async () => {
              setInstalling(true);
              try {
                const available = consumeInstallPrompt();
                if (!available) return;
                await available.prompt();
                const choice = await available.userChoice;
                if (choice.outcome === "accepted") setVisible(false);
              } catch {
                /* Keep the manual installation instructions available. */
              } finally {
                setPrompt(null);
                setInstalling(false);
              }
            }}
          >
            <Download className="size-4" />
            {installing ? "Instalando…" : "Instalar aplicativo"}
          </Button>
        )}
      </div>
      <button
        aria-label="Dispensar orientação de instalação"
        className="rounded p-1 text-muted-foreground"
        onClick={() => {
          dismissedRef.current = true;
          setVisible(false);
          try {
            sessionStorage.setItem("deliveryos.install-dismissed", "yes");
          } catch {
            /* Optional preference. */
          }
        }}
      >
        <X className="size-4" />
      </button>
    </aside>
  );
}
