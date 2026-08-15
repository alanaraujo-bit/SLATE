import { loadSnapshot } from "@/lib/snapshot";
import { Dashboard } from "@/components/dashboard";

// Roadmap state changes independently of deploys, so this page must never be
// served from a build-time cache.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page() {
  try {
    const snapshot = await loadSnapshot();
    return <Dashboard initial={snapshot} />;
  } catch (error) {
    // A database that is unreachable is a real operational state, not a crash.
    // Say so plainly rather than rendering a broken page (mandate §32).
    const message = error instanceof Error ? error.message : "Unknown error";
    return (
      <main className="shell">
        <div className="panel">
          <div className="panel__head">
            <h1 className="panel__title">Control Center unavailable</h1>
          </div>
          <div className="panel__body">
            <p className="notice notice--error">
              Roadmap state could not be read from the database.
            </p>
            <pre className="code-line">{message}</pre>
          </div>
        </div>
      </main>
    );
  }
}
