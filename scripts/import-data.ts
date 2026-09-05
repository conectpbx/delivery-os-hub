/**
 * Importa os dados exportados para um novo projeto Supabase.
 *
 * Uso:
 *   bun scripts/import-data.ts \
 *     --url https://<novo-projeto>.supabase.co \
 *     --service-role-key <service-role-key-do-novo-projeto> \
 *     --in ./backup
 *
 * O script:
 * 1. Le os JSONs gerados por export-data.ts.
 * 2. Cria usuarios no auth do novo projeto com os mesmos UUIDs (email placeholder).
 * 3. Insere os registros nas tabelas public.
 *
 * Apos a importacao, os usuarios devem usar "Esqueci a senha" ou Magic Link
 * para acessar as contas criadas com email placeholder.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/integrations/supabase/types";
import fs from "node:fs";
import path from "node:path";

const TABLES: (keyof Database["public"]["Tables"])[] = [
  "profiles",
  "apps",
  "deliveries",
  "fuelings",
  "maintenances",
  "expenses",
  "goals",
  "ai_scan_usage",
];

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };

  const url = get("--url");
  const serviceRoleKey = get("--service-role-key");
  const inputDir = get("--in") || "./backup";

  if (!url || !serviceRoleKey) {
    console.error(
      "Uso: bun scripts/import-data.ts --url <url> --service-role-key <key> [--in <dir>]",
    );
    process.exit(1);
  }

  return { url, serviceRoleKey, inputDir };
}

async function main() {
  const { url, serviceRoleKey, inputDir } = parseArgs();

  const supabase = createClient<Database>(url, serviceRoleKey, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  // Coleta todos os user_ids unicos dos dados exportados.
  const userIds = new Set<string>();
  for (const table of TABLES) {
    const file = path.join(inputDir, `${table}.json`);
    if (!fs.existsSync(file)) {
      console.warn(`Arquivo nao encontrado: ${file}`);
      continue;
    }
    const rows = JSON.parse(fs.readFileSync(file, "utf-8")) as Array<Record<string, unknown>>;
    for (const row of rows) {
      if (row.user_id && typeof row.user_id === "string") {
        userIds.add(row.user_id);
      }
      if (table === "profiles" && row.id && typeof row.id === "string") {
        userIds.add(row.id);
      }
    }
  }

  console.log(`Encontrados ${userIds.size} usuarios unicos nos dados.`);

  // Cria usuarios no novo projeto com os mesmos UUIDs.
  const createdUsers: string[] = [];
  const existingUsers: string[] = [];

  for (const userId of userIds) {
    const email = `migrate+${userId}@placeholder.local`;

    const { data: existing } = await supabase.auth.admin.getUserById(userId);
    if (existing.user) {
      existingUsers.push(userId);
      continue;
    }

    const { error } = await supabase.auth.admin.createUser({
      id: userId,
      email,
      email_confirm: true,
      password: crypto.randomUUID().replace(/-/g, ""),
    });

    if (error) {
      console.error(`Erro ao criar usuario ${userId}:`, error.message);
    } else {
      createdUsers.push(userId);
    }
  }

  console.log(`${createdUsers.length} usuarios criados, ${existingUsers.length} ja existiam.`);

  // Insere os dados nas tabelas public.
  for (const table of TABLES) {
    const file = path.join(inputDir, `${table}.json`);
    if (!fs.existsSync(file)) continue;

    const rows = JSON.parse(fs.readFileSync(file, "utf-8")) as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      console.log(`Tabela ${table}: 0 registros, ignorada.`);
      continue;
    }

    console.log(`Importando ${rows.length} registros em ${table}...`);

    const { error } = await supabase.from(table).insert(rows as never);
    if (error) {
      console.error(`Erro ao importar ${table}:`, error.message);
    } else {
      console.log(`  ${rows.length} registros importados em ${table}.`);
    }
  }

  console.log("\nImportacao finalizada.");
  console.log(
    "Lembrete: os usuarios criados com email placeholder precisam redefinir senha ou usar Magic Link.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
