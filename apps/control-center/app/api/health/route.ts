import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@slate/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Service health (mandate §35).
 *
 * Reports enough about the database configuration to diagnose a broken
 * connection without ever disclosing the credential: presence, length, scheme
 * and host are safe; user, password and full URL are not, and are never
 * included in any branch of this handler.
 */
export async function GET() {
  const raw = process.env.DATABASE_URL;

  const config = {
    present: typeof raw === "string" && raw.length > 0,
    length: raw?.length ?? 0,
    // Só o nome do esquema, sem "://" — a parte útil para diagnóstico, e nada
    // que se pareça com o começo de uma URL de conexão.
    scheme: raw && raw.includes("://") ? raw.slice(0, raw.indexOf("://")) : null,
    parses: false as boolean,
    host: null as string | null,
    hasTrailingWhitespace: raw ? raw !== raw.trim() : false,
    hasControlChars: raw ? /[\u0000-\u001F\u007F]/.test(raw) : false,
  };

  if (raw) {
    try {
      const parsed = new URL(raw);
      config.parses = true;
      config.host = parsed.host;
    } catch {
      config.parses = false;
    }
  }

  let database: { reachable: boolean; error: string | null; roundTripMs: number | null } = {
    reachable: false,
    error: null,
    roundTripMs: null,
  };

  if (config.parses) {
    const startedAt = Date.now();
    try {
      const db = getDb();
      await db.execute(sql`select 1`);
      database = { reachable: true, error: null, roundTripMs: Date.now() - startedAt };
    } catch (error) {
      database = {
        reachable: false,
        error: error instanceof Error ? error.message : "Unknown error",
        roundTripMs: Date.now() - startedAt,
      };
    }
  }

  const healthy = config.present && config.parses && database.reachable;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      service: "slate-control-center",
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? null,
      environment: process.env.VERCEL_ENV ?? "unknown",
      config,
      database,
      checkedAt: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
