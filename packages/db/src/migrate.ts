import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Applies migrations against DATABASE_URL.
 *
 * Run as a deliberate step, never from a Vercel build: concurrent preview
 * builds would race each other applying the same migration.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(here, "..", "migrations");

  const client = postgres(url, { ssl: "require", max: 1 });
  const db = drizzle(client);

  const target = new URL(url).host;
  console.log(`Applying migrations from ${migrationsFolder} to ${target}`);

  try {
    await migrate(db, { migrationsFolder });
    console.log("Migrations applied.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
