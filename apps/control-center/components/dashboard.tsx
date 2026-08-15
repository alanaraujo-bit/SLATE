"use client";

import { useState } from "react";
import type { Snapshot } from "@/lib/snapshot";
import { useLiveSnapshot, type LinkState } from "./use-live-snapshot";
import { Tree } from "./tree";
import { Panel, ProgressRail, formatPercent, relativeTime } from "./primitives";

export function Dashboard({ initial }: { initial: Snapshot }) {
  const { snapshot, link } = useLiveSnapshot(initial);

  return (
    <main className="shell">
      <Masthead snapshot={snapshot} link={link} />

      <div className="columns">
        <div className="rail">
          <Panel
            title="Roadmap"
            flush
            action={
              <span className="mono" style={{ color: "var(--text-tertiary)" }}>
                {snapshot.totals.completedLeaves}/{snapshot.totals.leaves} tasks
              </span>
            }
          >
            <Tree nodes={snapshot.tree} />
          </Panel>
        </div>

        <aside className="rail">
          <CurrentExecution snapshot={snapshot} />
          <OperatorActions actions={snapshot.operatorActions} />
          <Activity events={snapshot.activity} />
          <Deployments deployments={snapshot.deployments} />
        </aside>
      </div>
    </main>
  );
}

function Masthead({ snapshot, link }: { snapshot: Snapshot; link: LinkState }) {
  const { totals, counts } = snapshot;

  return (
    <header>
      <div className="masthead">
        <div>
          <div className="brand">
            <span className="brand__mark" aria-hidden="true">
              S
            </span>
            <div>
              <div className="brand__name">{snapshot.project.name}</div>
              <div className="brand__sub">Development Control Center</div>
            </div>
          </div>
        </div>

        <div className="headline">
          <span className="headline__value">{formatPercent(snapshot.overall)}</span>
          <span className="headline__label">Overall progress</span>
        </div>
      </div>

      <div style={{ marginBottom: "var(--space-5)" }}>
        <ProgressRail value={snapshot.overall} tall label="Overall project progress" />
      </div>

      <div className="panel" style={{ marginBottom: "var(--space-5)" }}>
        <div className="stats">
          <Stat value={String(totals.items)} label="Work items" />
          <Stat
            value={`${totals.completedLeaves}/${totals.leaves}`}
            label="Tasks complete"
          />
          <Stat
            value={`${totals.gatesPassed}/${totals.gates}`}
            label="Gates passed"
          />
          <Stat value={String(counts.IN_PROGRESS)} label="In progress" />
          <Stat
            value={String(counts.OPERATOR_REQUIRED + counts.BLOCKED_EXTERNAL)}
            label="Blocked"
          />
          <Stat value={String(counts.REOPENED)} label="Reopened" />
        </div>
        <div
          className="panel__head"
          style={{ borderBottom: "none", borderTop: "1px solid var(--border)" }}
        >
          <ConnectionIndicator link={link} />
          <span className="mono" style={{ color: "var(--text-tertiary)" }}>
            updated {relativeTime(snapshot.generatedAt)}
          </span>
        </div>
      </div>
    </header>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat">
      <div className="stat__value">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  );
}

function ConnectionIndicator({ link }: { link: LinkState }) {
  const text =
    link === "live" ? "Live" : link === "reconnecting" ? "Reconnecting" : "Offline";
  return (
    <span className="link-state" data-state={link}>
      <span className="link-state__dot" aria-hidden="true" />
      {text}
      <span className="visually-hidden" role="status">
        Connection {text}
      </span>
    </span>
  );
}

function CurrentExecution({ snapshot }: { snapshot: Snapshot }) {
  const exec = snapshot.execution;

  if (!exec || (!exec.operation && !exec.itemKey)) {
    return (
      <Panel title="Current execution">
        <p className="notice">Idle — no task is currently executing.</p>
      </Panel>
    );
  }

  return (
    <Panel title="Current execution">
      <dl className="kv">
        {exec.itemKey && (
          <>
            <dt>Task</dt>
            <dd>
              <span className="mono" style={{ color: "var(--text-tertiary)" }}>
                {exec.itemKey}
              </span>
              <br />
              {exec.itemTitle}
            </dd>
          </>
        )}
        {exec.operation && (
          <>
            <dt>Operation</dt>
            <dd>{exec.operation}</dd>
          </>
        )}
        {exec.branch && (
          <>
            <dt>Branch</dt>
            <dd className="mono">{exec.branch}</dd>
          </>
        )}
        {exec.commitSha && (
          <>
            <dt>Commit</dt>
            <dd className="mono">{exec.commitSha.slice(0, 10)}</dd>
          </>
        )}
        {exec.environment && (
          <>
            <dt>Environment</dt>
            <dd className="mono">{exec.environment}</dd>
          </>
        )}
        <dt>Updated</dt>
        <dd>{relativeTime(exec.updatedAt)}</dd>
      </dl>
    </Panel>
  );
}

function OperatorActions({ actions }: { actions: Snapshot["operatorActions"] }) {
  const open = actions.filter((action) => action.status !== "RESOLVED");

  return (
    <Panel
      title="Operator actions"
      flush
      action={
        <span className="mono" style={{ color: open.length ? "var(--warning)" : "var(--text-tertiary)" }}>
          {open.length} open
        </span>
      }
    >
      {open.length === 0 ? (
        <p className="notice">Nothing is waiting on you.</p>
      ) : (
        open.map((action) => <ActionRow key={action.code} action={action} />)
      )}
    </Panel>
  );
}

function ActionRow({ action }: { action: Snapshot["operatorActions"][number] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="action">
      <button
        type="button"
        className="action__head"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span>
          <span className="action__code">{action.code}</span>
          <span className="action__title" style={{ display: "block" }}>
            {action.title}
          </span>
        </span>
        <span className="chip" data-status={action.projectBlocked ? "BLOCKED_EXTERNAL" : "OPERATOR_REQUIRED"}>
          {action.projectBlocked ? "Blocking" : "Non-blocking"}
        </span>
      </button>

      {open && (
        <div className="action__body">
          {action.why && (
            <Field label="Why">
              <p>{action.why}</p>
            </Field>
          )}
          {action.whatToDo && (
            <Field label="What to do">
              <p>{action.whatToDo}</p>
            </Field>
          )}
          {action.howToValidate && (
            <Field label="How to validate">
              <p className="code-line">{action.howToValidate}</p>
            </Field>
          )}
          {action.blocks && (
            <Field label="Blocks">
              <p>{action.blocks}</p>
            </Field>
          )}
          {action.alreadyCompleted && (
            <Field label="Already done">
              <p>{action.alreadyCompleted}</p>
            </Field>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="action__field">
      <h4>{label}</h4>
      {children}
    </div>
  );
}

function Activity({ events }: { events: Snapshot["activity"] }) {
  return (
    <Panel title="Activity" flush>
      {events.length === 0 ? (
        <p className="notice">No activity recorded yet.</p>
      ) : (
        <ul className="feed">
          {events.map((event) => (
            <li className="feed__item" data-severity={event.severity} key={event.id}>
              <span className="feed__dot" aria-hidden="true" />
              <div>
                <div className="feed__title">{event.title}</div>
                {event.detail && (
                  <div className="feed__time" style={{ color: "var(--text-secondary)" }}>
                    {event.detail}
                  </div>
                )}
                <time className="feed__time" dateTime={event.createdAt}>
                  {relativeTime(event.createdAt)}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Deployments({ deployments }: { deployments: Snapshot["deployments"] }) {
  return (
    <Panel title="Deployments" flush>
      {deployments.length === 0 ? (
        <p className="notice">No deployments recorded yet.</p>
      ) : (
        <ul className="feed">
          {deployments.map((deploy, index) => (
            <li
              className="feed__item"
              data-severity={deploy.status === "READY" ? "SUCCESS" : "WARNING"}
              key={`${deploy.createdAt}-${index}`}
            >
              <span className="feed__dot" aria-hidden="true" />
              <div>
                <div className="feed__title">
                  {deploy.target} → <span className="mono">{deploy.environment}</span>
                </div>
                {deploy.url && (
                  <a className="feed__time" href={deploy.url} target="_blank" rel="noreferrer">
                    {deploy.url.replace(/^https?:\/\//, "")}
                  </a>
                )}
                <time className="feed__time" dateTime={deploy.createdAt} style={{ display: "block" }}>
                  {relativeTime(deploy.createdAt)}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
