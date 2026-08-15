import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export * from "./progress";

export type Database = ReturnType<typeof createDb>;

let cached: Database | undefined;

/**
 * Creates a Drizzle client.
 *
 * Serverless callers should use `getDb()` instead, which memoises across warm
 * invocations. Opening a fresh pool per request exhausts Postgres connections
 * quickly under Fluid Compute's instance reuse.
 */
export function createDb(connectionString: string) {
  /*
   * O trim não é paranoia: é a correção de um erro que já cometi duas vezes.
   * Gravar um segredo com `valor | comando` acrescenta uma quebra de linha, e
   * o resultado é um `TypeError: Invalid URL` vindo de dentro do driver, que
   * não diz nada sobre a causa. Custou um diagnóstico longo na primeira vez e
   * uma execução vermelha de CI na segunda.
   */
  const client = postgres(connectionString.trim(), {
    // Railway's TCP proxy terminates TLS with its own chain; `require` keeps
    // the connection encrypted without demanding a locally-trusted CA.
    ssl: "require",
    max: 5,
    idle_timeout: 20,
    connect_timeout: 15,
  });
  return drizzle(client, { schema });
}

export function getDb(): Database {
  if (cached) return cached;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. The Control Center reads roadmap state from " +
        "Postgres; there is no local fallback by design (mandate §14).",
    );
  }

  cached = createDb(url);
  return cached;
}

export { schema };
