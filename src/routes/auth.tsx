import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/hooks/useAuth";
import { Brand } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar no Delivery OS — Gestão para entregadores" },
      {
        name: "description",
        content:
          "Acesse sua conta Delivery OS e acompanhe ganhos, custos, quilometragem e manutenção do veículo em um só lugar.",
      },
      { property: "og:title", content: "Entrar no Delivery OS" },
      {
        property: "og:description",
        content: "Login do sistema de gestão financeira e operacional para entregadores.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && session) void navigate({ to: "/dashboard" });
  }, [loading, session, navigate]);

  function translate(message: string) {
    const m = message.toLowerCase();
    if (m.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
    if (m.includes("email not confirmed")) return "Confirme seu e-mail antes de entrar.";
    if (m.includes("already registered")) return "Este e-mail já possui conta. Faça login.";
    if (m.includes("weak") || m.includes("pwned"))
      return "Senha muito fraca ou vazada. Escolha outra mais forte.";
    if (m.includes("password")) return "Senha inválida: use ao menos 6 caracteres.";
    if (m.includes("rate limit")) return "Muitas tentativas. Aguarde um instante.";
    return message;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "signup") {
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard`,
            data: { full_name: name },
          },
        });
        if (err) throw err;
        if (data.session) {
          void navigate({ to: "/dashboard" });
        } else {
          setInfo("Conta criada! Confirme o e-mail enviado para acessar.");
          toast.success("Conta criada! Verifique seu e-mail para confirmar.");
        }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      }
    } catch (err) {
      const msg = translate(err instanceof Error ? err.message : "Não foi possível autenticar");
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }


  async function google() {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("Falha no login com Google");
      return;
    }
    if (result.redirected) return;
    void navigate({ to: "/dashboard" });
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="brand-gradient hidden flex-col justify-between p-10 text-primary-foreground lg:flex">
        <p className="text-lg font-semibold">Delivery OS</p>
        <div className="space-y-4">
          <h2 className="max-w-sm text-3xl font-semibold leading-tight">
            Ganhos, custos e veículo na mesma tela.
          </h2>
          <p className="max-w-sm text-sm opacity-90">
            GPS automático, lucro real por quilômetro, agenda de manutenção, metas e relatórios
            prontos para exportar.
          </p>
        </div>
        <p className="text-xs opacity-75">Feito para quem roda todos os dias.</p>
      </div>

      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <Brand />
          <h1 className="mt-8 text-2xl font-semibold tracking-tight">
            {mode === "login" ? "Entrar" : "Criar conta"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "login"
              ? "Acesse seu painel de operação."
              : "Comece a medir seu lucro real hoje."}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === "signup" ? (
              <div className="space-y-2">
                <Label htmlFor="name">Nome</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {info ? (
              <p className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
                {info}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar conta"}
            </Button>
          </form>

          <Button variant="outline" className="mt-3 w-full" onClick={google}>
            Continuar com Google
          </Button>

          <button
            type="button"
            className="mt-6 w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => {
              setError(null);
              setInfo(null);
              setMode(mode === "login" ? "signup" : "login");
            }}
          >
            {mode === "login" ? "Não tem conta? Cadastre-se" : "Já tenho conta"}
          </button>
        </div>
      </div>
    </div>
  );
}
