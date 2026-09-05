/**
 * Exporta os dados das tabelas public do Delivery OS via API REST.
 *
 * Uso:
 *   bun scripts/export-data.ts \
 *     --url https://<projeto-atual>.supabase.co \
 *     --key <anon-key-do-projeto-atual> \
 *     --token <access-token-do-usuario> \
 *     --out ./backup
 *
 * O access token pode ser obtido no navegador apos login:
 *   const { data } = await supabase.auth.getSession();
 *   console.log(data.session.access_token);
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
  const key = get("--key");
  const token = get("--token");
  const out = get("--out") || "./backup";

  if (!url || !key || !token) {
    console.error("Uso: bun scripts/export-data.ts --url <url> --key <anon-key> --token <access-token> [--out <dir>]");
    process.exit(1);
  }

  return { url, key, token, out };
}

async function main() {
  const { url, key, token, out } = parseArgs();

  fs.mkdirSync(out, { recursive: true });

  const supabase = createClient<Database>(url, key, {
    auth: {
      storage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  for (const table of TABLES) {
    const file = path.join(out, `${table}.json`);
    console.log(`Exportando ${table}...`);

    const { data, error } = await supabase.from(table).select("*");
    if (error) {
      console.error(`Erro ao exportar ${table}:`, error.message);
      continue;
    }

    fs.writeFileSync(file, JSON.stringify(data ?? [], null, 2));
    console.log(`  ${(data ?? []).length} registros -> ${file}`);
  }

  console.log(`\nBackup salvo em: ${path.resolve(out)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
