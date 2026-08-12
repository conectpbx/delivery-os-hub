# Deploy — delivery-os-hub

## Arquitetura

Esse projeto usa **TanStack Start** (framework fullstack com SSR real — API routes, server functions, middleware de CSRF), gerado originalmente pelo Lovable com preset padrão para **Cloudflare Workers**. Como a decisão foi manter tudo self-hosted na VM, o preset foi trocado para **`node-server`**, que gera um servidor Node standalone em vez de um Worker.

Diferente do `transform-hub` (SPA estático servido por nginx), aqui o container **executa um processo Node continuamente** — não é só arquivos estáticos.

Fluxo de deploy:

1. Push na branch `main` dispara `.github/workflows/deploy.yml`.
2. GitHub Actions instala dependências, roda `npm run build` (gera `.output/`).
3. Sincroniza `.output/` via rsync/SSH para `/home/opc/delivery-os-hub/output/` na VM.
4. Via SSH, garante que o container está no ar com `docker compose up -d --force-recreate` (o `--force-recreate` é necessário porque, diferente de nginx servindo arquivos estáticos, o processo Node carrega o código na memória ao iniciar — só atualizar os arquivos no disco não é suficiente).
5. Nginx Proxy Manager (NPM), já rodando na VM para outros serviços, faz o proxy reverso do domínio público para a porta 3000 do container.

## vite.config.ts (versão atual)

```ts
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  nitro: {
    preset: "node-server",
  },
  vite: {
    plugins: [
      VitePWA({
        strategies: "generateSW",
        registerType: "autoUpdate",
        // ...configuração completa do PWA/workbox
      }),
    ],
  },
});
```

**Importante:** o comentário original do template do Lovable avisa que o preset padrão é Cloudflare. Se o projeto for resetado ou recriado a partir de um template novo, é preciso reaplicar o `nitro: { preset: "node-server" }` manualmente.

## docker-compose.yaml (versão atual)

```yaml
version: "3.9"
services:
  app:
    image: node:22-alpine
    container_name: delivery-os-hub
    restart: always
    working_dir: /app
    command: node server/index.mjs
    ports:
      - "3000:3000"
    volumes:
      - ./output:/app:ro
    environment:
      - NODE_ENV=production
      - PORT=3000
      - HOST=0.0.0.0
    networks:
      - app-network
networks:
  app-network:
    driver: bridge
```

**Atenção ao volume:** precisa ser `./output` (relativo, com ponto) — se virar `/output` (absoluto), o container monta uma pasta vazia na raiz do sistema e falha com `Cannot find module '/app/server/index.mjs'`.

## src/start.ts — import corrigido

```ts
import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/start-client-core";
// NÃO importar de "@tanstack/react-start" — ver troubleshooting #2 abaixo
```

## Nginx Proxy Manager

Proxy Host configurado para o domínio do projeto:
- **Forward Hostname/IP:** IP da VM (ex: `129.148.44.243`)
- **Forward Port:** `3000`
- **Scheme:** `http` (o container Node não serve TLS diretamente — o NPM cuida do HTTPS na borda)
- **SSL:** certificado Let's Encrypt via NPM, com "Force SSL" ativado

## Troubleshooting — problemas já enfrentados e soluções

### 1. Servidor "roda e sai" sem erro (loop de restart com exit code 0)

**Causa:** o `vite.config.ts` ainda estava com o preset padrão `cloudflare-module`. O `index.mjs` gerado nesse preset é um **handler de Cloudflare Worker** (`export default { fetch(request, env, context) {...} }`), não um servidor Node tradicional com `.listen()`. Ele carrega, não encontra nenhum runtime do Cloudflare pra chamá-lo, e encerra — sem erro, porque tecnicamente não é um bug, é o comportamento correto de um Worker rodando fora do ambiente esperado.

**Diagnóstico:**
```bash
cat .output/nitro.json | grep preset
# Se retornar "cloudflare-module" em vez de "node-server", é isso.
```

**Solução:** adicionar `nitro: { preset: "node-server" }` ao `vite.config.ts` (ver seção acima) e rebuildar do zero.

### 2. `TypeError: createCsrfMiddleware is not a function`

**Causa:** bug conhecido de bundling em produção do TanStack Start. O pacote `@tanstack/react-start` reexporta `createCsrfMiddleware` de duas formas simultâneas no mesmo arquivo (`export * from "@tanstack/start-client-core"` **e** uma reexportação nomeada explícita). Essa duplicidade confunde o bundler (Rollup/Nitro) durante o build de produção, gerando um bundle onde a função vira `undefined` em runtime — mesmo funcionando normalmente em modo dev.

**Solução:** importar direto do pacote de origem, pulando a camada de reexportação problemática:
```ts
// Antes (quebra em produção):
import { createCsrfMiddleware } from "@tanstack/react-start";

// Depois (funciona):
import { createCsrfMiddleware } from "@tanstack/start-client-core";
```

**Nota:** ao investigar, tome cuidado com **cache de build** — o Nitro/Vite cacheiam artefatos em `node_modules/.vite` e `node_modules/.nitro`. Depois de editar o código-fonte, se o hash do chunk gerado (`_ssr/server-*.mjs`) não mudar entre builds, o cache não foi invalidado:
```bash
rm -rf .output node_modules/.vite node_modules/.nitro
npm run build
```

### 3. `npm ci` falhando (`package.json`/`package-lock.json` fora de sincronia)

Mesma causa e solução do `transform-hub` (ver `DEPLOY.md` desse projeto) — aconteceu aqui também após merges trazendo novas dependências (`vite-plugin-pwa`, `workbox-*`) sem lock file atualizado junto. Resolvido com `npm install` (não `ci`) para regenerar o lock file, seguido de commit.

Quando o projeto tem muitas dependências conflitantes acumuladas, às vezes vale fazer limpeza total em vez de update incremental:
```bash
rm -rf node_modules package-lock.json
npm install
```

### 4. Container não acessível via Nginx Proxy Manager

Duas causas concorrentes, ambas precisaram ser corrigidas:

**a) Porta errada configurada no NPM.** O projeto passou por iterações usando 8080 e 3000 — confirme sempre a porta real com `docker compose ps` antes de configurar o Proxy Host.

**b) Firewall do sistema operacional (`firewalld`) bloqueando a porta.** A VM usa Oracle Linux com `firewalld` ativo, que por padrão só libera a porta 22 (SSH) além das portas já configuradas manualmente. Mesmo com o container respondendo em `localhost:3000`, o NPM (rodando em outro container) não conseguia alcançar essa porta até liberá-la:
```bash
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload
```

**c) Scheme errado no Proxy Host.** O campo "Scheme" do NPM precisa ser `http` (não `https`), já que o container Node serve HTTP puro — o TLS é responsabilidade do NPM na borda, não do app.

**Diagnóstico útil para esse tipo de problema:**
```bash
# 1. App responde localmente?
curl -4 -I http://localhost:3000

# 2. Firewall libera a porta?
sudo firewall-cmd --list-ports

# 3. NPM consegue alcançar o backend? (de dentro do container do NPM)
docker exec -it nginx-proxy-app-1 wget -qO- http://<IP_DA_VM>:3000 -T 5
```

### 5. `Cannot find module '/app/server/index.mjs'`

**Causa:** o volume no `docker-compose.yaml` estava apontando para `/output` (caminho absoluto, pasta inexistente na raiz da VM) em vez de `./output` (relativo à pasta do projeto).

**Diagnóstico:**
```bash
find /home/opc/delivery-os-hub/output -maxdepth 2   # confirma se os arquivos existem no lugar certo
cat docker-compose.yaml | grep volumes -A 2          # confirma o caminho configurado
```

**Solução:** garantir que a linha seja `- ./output:/app:ro` (com o ponto).

## Comandos úteis de referência

```bash
# Ver status do container
docker compose ps

# Ver logs
docker compose logs -f app

# Testar localmente, ignorando IPv6 (curl às vezes tenta ::1 antes de 127.0.0.1)
curl -4 -I http://localhost:3000

# Rebuild manual completo, sem cache, para testar antes do push
rm -rf .output node_modules/.vite node_modules/.nitro
docker run --rm -v "$(pwd):/app" -w /app node:22-alpine npm run build

# Testar o servidor localmente antes de subir via compose
docker run --rm -it \
  -v "$(pwd)/.output:/app:ro" -w /app -p 3000:3000 \
  -e NODE_ENV=production -e PORT=3000 -e HOST=0.0.0.0 \
  node:22-alpine node server/index.mjs

# Forçar recriação do container após deploy manual
docker compose up -d --force-recreate

# Monitorar memória em runtime (processo Node fica residente, diferente de nginx estático)
docker stats delivery-os-hub --no-stream
```

## Nota sobre memória

Diferente do `transform-hub` (nginx servindo estáticos, praticamente sem uso de RAM), esse projeto roda um **servidor Node continuamente**, que consome memória real proporcional ao tráfego e complexidade do SSR. Como a VM tem recursos limitados (~1GB RAM total, compartilhada com outros serviços), monitore periodicamente:
```bash
docker stats delivery-os-hub --no-stream
```
Se o consumo ficar consistentemente alto, considerar: aumentar a RAM da VM, adicionar `mem_limit` no compose, ou revisitar a opção de hospedar via Cloudflare Workers/Vercel (que era a configuração original do template, sem essa limitação de memória residente).
