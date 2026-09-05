# Migracao do banco Delivery OS para outro Supabase

Este guia usa os scripts em `scripts/` para exportar o schema e os dados do projeto atual e importar em um novo projeto Supabase.

## 1. Exportar o schema

O arquivo `scripts/export-schema.sql` ja contem todas as migrations consolidadas na ordem correta. Basta executa-lo no SQL Editor do novo projeto Supabase.

```text
scripts/export-schema.sql
```

## 2. Exportar os dados do projeto atual

### 2.1 Obter o access token no navegador

Faca login no app e execute no console do navegador:

```js
const { data } = await supabase.auth.getSession();
console.log(data.session.access_token);
```

### 2.2 Rodar o script de exportacao

```bash
bun scripts/export-data.ts \
  --url https://<projeto-atual>.supabase.co \
  --key <anon-key-do-projeto-atual> \
  --token <access-token-copiado-do-console> \
  --out ./backup
```

Isso gera arquivos JSON em `./backup/` para cada tabela public.

## 3. Importar os dados no novo projeto

No novo projeto Supabase, va em Settings > API > service_role key e copie a chave.

```bash
bun scripts/import-data.ts \
  --url https://<novo-projeto>.supabase.co \
  --service-role-key <service-role-key-do-novo-projeto> \
  --in ./backup
```

O script:

1. Cria usuarios no auth do novo projeto com os mesmos UUIDs dos dados exportados.
2. Insere os registros nas tabelas `public`.

## 4. Configurar autenticacao no novo projeto

- Habilite o Google OAuth no novo projeto Supabase.
- Atualize os `redirect_uri` para o dominio do app apos a troca.
- Configure o provedor no Lovable Cloud, se o destino for um projeto Lovable Cloud.

## 5. Atualizar o app

Troque as variaveis de ambiente para apontar para o novo projeto:

```env
VITE_SUPABASE_URL=https://<novo-projeto>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon-key-do-novo-projeto>
SUPABASE_URL=https://<novo-projeto>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<anon-key-do-novo-projeto>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key-do-novo-projeto>
```

Se o destino for Lovable Cloud, conecte o novo projeto pelo painel do Lovable; as variaveis serao gerenciadas automaticamente.

## 6. Redefinir acesso dos usuarios

Os usuarios migrados foram criados com emails placeholder. Eles precisam:

- Fazer login com Google OAuth (se usavam esse metodo).
- Ou usar "Esqueci a senha" / Magic Link para redefinir o acesso.

## Limitacoes

- Nao e possivel exportar senhas/hash de `auth.users` do projeto atual sem a service role key do Lovable Cloud (indisponivel no self-serve).
- Os UUIDs dos usuarios sao preservados, entao os relacionamentos entre tabelas `public` continuam consistentes.
- Storage: o projeto atual nao possui buckets, entao nao ha arquivos para migrar.
