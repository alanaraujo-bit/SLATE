import type { GateStatus, WorkStatus } from "@slate/db/schema";

export function StatusChip({ status }: { status: WorkStatus }) {
  return (
    <span className="chip" data-status={status}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function ProgressRail({
  value,
  tall = false,
  tone,
  label,
}: {
  value: number;
  tall?: boolean;
  tone?: "success" | "warning" | "danger";
  label?: string;
}) {
  const pct = Math.round(value * 1000) / 10;
  return (
    <div
      className={tall ? "rail-track rail-track--tall" : "rail-track"}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? "Progress"}
    >
      <div className="rail-fill" data-tone={tone} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Panel({
  title,
  action,
  flush = false,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <header className="panel__head">
        <h2 className="panel__title">{title}</h2>
        {action}
      </header>
      <div className={flush ? "panel__body panel__body--flush" : "panel__body"}>
        {children}
      </div>
    </section>
  );
}

export function GateList({
  gates,
}: {
  gates: Array<{ key: string; title: string; status: GateStatus; evidence: string | null }>;
}) {
  if (gates.length === 0) return null;
  return (
    <ul className="gates">
      {gates.map((gate) => (
        <li className="gate" data-status={gate.status} key={gate.key}>
          <span className="gate__box" aria-hidden="true">
            {gate.status === "PASSED" ? "✓" : gate.status === "FAILED" ? "✕" : ""}
          </span>
          <span>{gate.title}</span>
          <span className="visually-hidden">{gate.status}</span>
        </li>
      ))}
    </ul>
  );
}

export function formatPercent(value: number): string {
  return `${(Math.round(value * 1000) / 10).toFixed(1)}%`;
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
