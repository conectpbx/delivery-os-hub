import { createFileRoute, Link } from "@tanstack/react-router";
import {
  BrainCircuit,
  FileSpreadsheet,
  Gauge,
  MapPinned,
  ShieldCheck,
  Smartphone,
  Wallet,
  Wrench,
} from "lucide-react";
import { Brand } from "@/components/AppShell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Delivery OS — gestão completa para entregadores" },
      {
        name: "description",
        content:
          "GPS automático, lucro real, abastecimento, manutenção, scanner com IA e relatórios em PDF e Excel em um único sistema para entregadores.",
      },
      { property: "og:title", content: "Delivery OS — gestão completa para entregadores" },
      {
        property: "og:description",
        content:
          "Una ganhos, custos, quilometragem e manutenção do veículo para enxergar o lucro real de cada corrida.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

const features = [
  {
    icon: Gauge,
    title: "Dashboard de lucro real",
    text: "Receita diária, custos, quilometragem, tempo parado e ranking de aplicativos em tempo real.",
  },
  {
    icon: MapPinned,
    title: "GPS e rotas",
    text: "Captura automática de localização, histórico de entregas e navegação direta até o cliente.",
  },
  {
    icon: Wallet,
    title: "Controle financeiro",
    text: "Abastecimentos, despesas e custo por quilômetro calculados a partir do consumo do seu veículo.",
  },
  {
    icon: Wrench,
    title: "Agenda de manutenção",
    text: "Trocas de óleo, pneus e revisões com lembretes por data ou quilometragem.",
  },
  {
    icon: BrainCircuit,
    title: "Scanner com IA",
    text: "Fotografe o cupom do posto e a inteligência artificial preenche litros, preço e total.",
  },
  {
    icon: FileSpreadsheet,
    title: "Relatórios e metas",
    text: "Comparação entre meses, exportação para Excel, relatório em PDF e planejamento de metas.",
  },
];

function Home() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Brand />
        <Button asChild size="sm">
          <Link to="/auth">Entrar</Link>
        </Button>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-5 pb-16 pt-10 sm:pt-16">
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <ShieldCheck className="size-3.5 text-primary" /> Plataforma SaaS para entregadores
          </p>
          <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl">
            O sistema que mostra o seu <span className="text-primary">lucro real</span>, não só o quanto você recebeu.
          </h1>
          <p className="mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">
            Delivery OS reúne GPS automático, gestão financeira, manutenção do veículo, análise de desempenho e
            inteligência artificial em um só lugar — no celular e no painel web.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/auth">Começar agora</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/dashboard">Ver dashboard</Link>
            </Button>
          </div>

          <dl className="mt-12 grid gap-4 sm:grid-cols-3">
            {[
              ["Lucro por corrida", "Descontando combustível, manutenção e despesas"],
              ["Ranking de apps", "Descubra qual aplicativo paga melhor por km"],
              ["Mapa de calor", "Saiba os melhores horários e dias para rodar"],
            ].map(([t, d]) => (
              <div key={t} className="rounded-2xl border border-border bg-card p-5">
                <dt className="text-sm font-semibold text-foreground">{t}</dt>
                <dd className="mt-1 text-sm text-muted-foreground">{d}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="border-y border-border bg-card/60">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <h2 className="text-2xl font-semibold tracking-tight">Tudo o que o entregador precisa</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              A maioria dos aplicativos controla só ganhos ou só despesas. Aqui a visão é completa.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <article key={f.title} className="rounded-2xl border border-border bg-background p-5">
                  <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                    <f.icon className="size-5" />
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{f.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16">
          <div className="flex flex-col items-start justify-between gap-6 rounded-3xl border border-border bg-primary p-8 text-primary-foreground sm:flex-row sm:items-center">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-semibold">
                <Smartphone className="size-5" /> Instale no celular e rode direto do app
              </h2>
              <p className="mt-2 max-w-xl text-sm opacity-90">
                Interface responsiva, offline-friendly e pronta para o dia a dia na rua.
              </p>
            </div>
            <Button asChild size="lg" variant="secondary">
              <Link to="/auth">Criar minha conta</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        Delivery OS · gestão completa para entregadores
      </footer>
    </div>
  );
}
