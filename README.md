# Delivery OS Hub

Desenvolva o sistema profissional, moderno e responsivo para os cenários abaixo:

sistema PWA chamado Delivery OS.

**Dashboard**
- Receita diária
- Lucro real
- Custos
- Quilometragem
- Tempo parado
- Ranking de aplicativos
- Mapa de calor de entregas
- Histórico completo

**Mobile**
- GPS automático
- Rotas
- Navegação
- Financeiro
- Abastecimento
- Manutenção
- IA
- Scanner OCR
- Relatórios

**Web**
- Dashboard completo
- Relatórios em PDF
- Exportação para Excel
- Controle financeiro
- Agenda de manutenção
- Planejamento de metas
- Comparação entre meses

**Diferencial**

A maior parte dos aplicativos existentes controla apenas ganhos ou apenas despesas. Um sistema que una GPS automático, gestão financeira, manutenção do veículo, análise de desempenho e inteligência artificial entregaria uma visão completa da atividade do entregador, algo que hoje é raro no mercado.

Esse tipo de plataforma também pode evoluir para um modelo de assinatura (SaaS), com aplicativo para Android/iOS e painel web para acompanhar relatórios detalhados.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/6ea0ef38-a00c-43ce-8d64-e281368be399).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Stack

- **Framework:** [TanStack Start](https://tanstack.com/start) (React + SSR)
- **Build:** Vite + Nitro (preset `node-server`)
- **Backend:** Supabase (auth, banco de dados, storage)
- **PWA:** Service Worker com atualização automática (`vite-plugin-pwa`)
- **Deploy:** GitHub Actions → VM própria (Docker + Nginx Proxy Manager)

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Build de produção

```bash
npm run build
```

Gera a pasta `.output/`:
- `.output/public/` — assets estáticos (JS, CSS, imagens, manifest do PWA)
- `.output/server/index.mjs` — servidor Node (SSR + API routes)

## Integração de GPS com app nativo

O rastreador da jornada aceita pontos enviados por uma WebView Android/iOS. O app nativo pode
usar `window.postMessage` ou disparar um `CustomEvent` chamado `deliveryos:gps` com este formato:

```json
{
  "type": "deliveryos:gps",
  "payload": {
    "latitude": -23.55052,
    "longitude": -46.633308,
    "accuracy": 12,
    "timestamp": 1791244800000
  }
}
```

Também são aceitos `lat`, `lng` e uma data ISO em `at`. Coordenadas, precisão e data são
validadas antes do cálculo. Quando chega o primeiro ponto nativo válido, o GPS do navegador é
desativado para impedir captura duplicada.

Ao iniciar, finalizar ou zerar uma jornada, a aplicação envia ao host React Native uma mensagem
com o tipo `deliveryos:trip-command` e os comandos `start`, `finish` ou `reset`. Os mesmos dados
são publicados como `CustomEvent` para outros tipos de WebView.

## Precisão e estabilidade do GPS

A captura no navegador solicita alta precisão e posições novas, sem reutilizar o cache. O rastreador processa cada leitura recebida, sem descartar amostras por um intervalo fixo; a frequência efetiva depende do dispositivo e do sistema operacional.

- Valida coordenadas, precisão e horário; descarta leituras anteriores à jornada, com mais de 60 segundos ou mais de 5 segundos no futuro.
- Rejeita deslocamentos que implicariam velocidade média acima de 180 km/h.
- Filtra oscilações usando a precisão informada pelo sensor, com um mínimo de 3 metros. Mantém a última posição aceita como referência para acumular deslocamentos lentos e preservar curvas curtas quando o sinal é preciso.
- Soma distâncias sem arredondar cada amostra, evitando erro acumulado.
- Após um intervalo superior a 60 segundos entre posições aceitas, estabelece uma nova referência sem somar um trajeto desconhecido. A quilometragem desse intervalo pode ficar subestimada.
- Prioriza a captura nativa após uma leitura válida, interrompendo a captura do navegador. A troca de sensores não soma a diferença entre suas estimativas de posição.

Esses filtros se aplicam às coordenadas capturadas pelo navegador e pela ponte nativa. A integração externa que fornece contadores de quilometragem mantém seu cálculo próprio.

A precisão real depende do aparelho, das permissões e da recepção do sinal. Alta precisão pode aumentar o consumo de bateria; captura em segundo plano depende do suporte do aplicativo nativo e do sistema operacional. Ainda é necessário avaliar o resultado em percursos reais, incluindo curvas, paradas e períodos sem sinal.

### Validação das melhorias

Foram aprovados 57 testes, o build de produção, a checagem TypeScript e o ESLint dos arquivos alterados. Os testes novos cobrem saltos, pontos inválidos ou antigos, oscilações parado, curvas curtas, distâncias fracionárias e recuperação após perda de sinal. O lint global tem pendências preexistentes, descritas separadamente do lint dos arquivos alterados.

Para executar as suítes existentes com o carregador TypeScript disponível nas dependências instaladas:

```bash
node --import tsx --input-type=module -e 'for (const file of ["gps-filter", "gps-ingestion", "integrated-gps-point", "integrated-trip", "metrics", "operation-time"]) await import(`./src/lib/${file}.test.ts`)'
```

## Como funcionam as atualizações

### Deploy do servidor (automático)

Todo push na branch `main` — seja feito localmente ou sincronizado a partir do Lovable — dispara o workflow `.github/workflows/deploy.yml`, que:
1. Builda o projeto no runner do GitHub (não na VM — evita problemas de memória)
2. Sincroniza `.output/` para a VM via rsync/SSH
3. Recria o container (`docker compose up -d --force-recreate`), aplicando o código novo

Não é necessário nenhum passo manual — só dar push. Acompanhe o progresso na aba **Actions** do repositório.

### Atualização do app no navegador (PWA — automática)

O app registra um Service Worker com `autoUpdate`. Quando há uma versão nova publicada:
- O navegador do usuário detecta e baixa os arquivos novos em segundo plano
- O novo Service Worker assume o controle imediatamente (`skipWaiting` + `clientsClaim`), sem exigir fechar o app manualmente
- O usuário vê a versão atualizada na próxima navegação ou reload — geralmente em poucos segundos após o deploy

### O que **não** é automático

- **Lock file desatualizado:** se novas dependências forem adicionadas ao `package.json`, é preciso rodar `npm install` localmente e commitar o `package-lock.json` atualizado — senão o `npm ci` do CI falha.
- **Mudanças de infraestrutura:** configuração do Nginx Proxy Manager, regras de firewall (`firewalld`) e domínio/DNS são feitas manualmente na VM, fora do pipeline de deploy.

## Arquitetura de deploy (detalhada)

Ver [`DEPLOY.md`](./DEPLOY.md) para a documentação completa da arquitetura de deploy, incluindo o histórico de problemas resolvidos (bug de bundling do TanStack Start, configuração de firewall, etc.) — útil como referência caso algo semelhante aconteça de novo.

## Deploy manual (fallback)

Se precisar fazer deploy sem passar pelo GitHub Actions, direto na VM:
```bash
cd /home/opc/delivery-os-hub
git pull origin main
docker compose up -d --force-recreate
```
Isso só reinicia o container com o que já estiver sincronizado em `output/` — não builda nada. Para builds manuais, veja os comandos de referência em `DEPLOY.md`.
