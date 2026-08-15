#!/usr/bin/env node
import { parseArgs } from "node:util";
import { and, desc, eq } from "drizzle-orm";
import { createDb } from "@slate/db";
import {
  activityEvents,
  deployments,
  executionState,
  projects,
  qualityGates,
  workItems,
  type WorkStatus,
} from "@slate/db/schema";
import {
  blockersToCompletion,
  overallProgress,
  toPercent,
  type WorkItemInput,
} from "@slate/db/progress";

/**
 * The roadmap write path (mandate §24).
 *
 * Execution drives roadmap state through this CLI rather than by editing a
 * page, so the published progress figure always derives from the same rows the
 * Control Center reads.
 *
 * The `complete` command deliberately refuses when quality gates are unmet or
 * children are unfinished. That refusal is the point: §57 forbids optimising
 * the number at the expense of the truth, and the cheapest way to enforce that
 * is to make the dishonest state unreachable through the only available tool.
 */

const USAGE = `
slate-roadmap — SLATE roadmap control

  start <key>                     Mark IN_PROGRESS and set current execution
  status <key> <STATUS>           Set an explicit status
  testing <key>                   Mark TESTING
  validating <key>                Mark VALIDATING
  complete <key>                  Mark COMPLETED (refused if gates or children are unmet)
  reopen <key> [--reason <text>]  Regression: COMPLETED -> REOPENED
  block <key> [--operator]        Mark BLOCKED_EXTERNAL or OPERATOR_REQUIRED

  gate <key> <gateKey> --pass|--fail|--na [--evidence <text>]
  exec [--operation <t>] [--branch <b>] [--commit <sha>] [--env <e>] [--item <key>]
  event --type <t> --title <t> [--detail <d>] [--severity INFO|SUCCESS|WARNING|ERROR] [--item <key>]
  deploy --env <e> --target <t> [--url <u>] [--commit <sha>] [--status <s>]
  report                          Print computed progress

Options: --project <slug> (default: slate)
Requires DATABASE_URL.
`;

const STATUSES: WorkStatus[] = [
  "PLANNED",
  "READY",
  "IN_PROGRESS",
  "TESTING",
  "VALIDATING",
  "BLOCKED_EXTERNAL",
  "OPERATOR_REQUIRED",
  "COMPLETED",
  "REOPENED",
];

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      project: { type: "string", default: "slate" },
      reason: { type: "string" },
      evidence: { type: "string" },
      operation: { type: "string" },
      branch: { type: "string" },
      commit: { type: "string" },
      env: { type: "string" },
      item: { type: "string" },
      type: { type: "string" },
      title: { type: "string" },
      detail: { type: "string" },
      severity: { type: "string" },
      target: { type: "string" },
      url: { type: "string" },
      pass: { type: "boolean" },
      fail: { type: "boolean" },
      na: { type: "boolean" },
      operator: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  const [command, ...rest] = positionals;

  if (values.help || !command) {
    console.log(USAGE);
    process.exit(command ? 0 : 1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const db = createDb(url);
  const slug = values.project ?? "slate";

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  if (!project) {
    console.error(`Project '${slug}' not found. Run the seed first.`);
    process.exit(1);
  }
  const projectId = project.id;

  const findItem = async (key: string) => {
    const [item] = await db
      .select()
      .from(workItems)
      .where(and(eq(workItems.projectId, projectId), eq(workItems.key, key)))
      .limit(1);
    if (!item) {
      console.error(`Work item '${key}' not found.`);
      process.exit(1);
    }
    return item;
  };

  const logEvent = async (
    type: string,
    title: string,
    opts: {
      detail?: string;
      severity?: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
      workItemId?: string;
    } = {},
  ) => {
    await db.insert(activityEvents).values({
      projectId,
      workItemId: opts.workItemId ?? null,
      type,
      title,
      detail: opts.detail ?? null,
      severity: opts.severity ?? "INFO",
    });
  };

  const setStatus = async (key: string, status: WorkStatus, detail?: string) => {
    const item = await findItem(key);
    const now = new Date();

    const patch: Partial<typeof workItems.$inferInsert> = { status, updatedAt: now };
    if (status === "IN_PROGRESS" && !item.startedAt) patch.startedAt = now;
    if (status === "COMPLETED") patch.completedAt = now;
    if (status === "REOPENED") patch.completedAt = null;

    await db.update(workItems).set(patch).where(eq(workItems.id, item.id));

    await logEvent(
      `status.${status.toLowerCase()}`,
      `${item.key} — ${item.title}: ${item.status} → ${status}`,
      {
        detail,
        severity:
          status === "COMPLETED"
            ? "SUCCESS"
            : status === "REOPENED" || status.startsWith("BLOCKED") || status === "OPERATOR_REQUIRED"
              ? "WARNING"
              : "INFO",
        workItemId: item.id,
      },
    );

    console.log(`${item.key}: ${item.status} → ${status}`);
    return item;
  };

  switch (command) {
    case "start": {
      const key = requireArg(rest[0], "key");
      const item = await setStatus(key, "IN_PROGRESS");
      await db
        .insert(executionState)
        .values({
          projectId,
          currentWorkItemId: item.id,
          operation: values.operation ?? item.title,
          branch: values.branch ?? null,
          commitSha: values.commit ?? null,
          environment: values.env ?? null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: executionState.projectId,
          set: {
            currentWorkItemId: item.id,
            operation: values.operation ?? item.title,
            updatedAt: new Date(),
          },
        });
      break;
    }

    case "status": {
      const key = requireArg(rest[0], "key");
      const raw = requireArg(rest[1], "STATUS").toUpperCase() as WorkStatus;
      if (!STATUSES.includes(raw)) {
        console.error(`Unknown status '${raw}'. One of: ${STATUSES.join(", ")}`);
        process.exit(1);
      }
      await setStatus(key, raw, values.reason);
      break;
    }

    case "testing":
      await setStatus(requireArg(rest[0], "key"), "TESTING");
      break;

    case "validating":
      await setStatus(requireArg(rest[0], "key"), "VALIDATING");
      break;

    case "block":
      await setStatus(
        requireArg(rest[0], "key"),
        values.operator ? "OPERATOR_REQUIRED" : "BLOCKED_EXTERNAL",
        values.reason,
      );
      break;

    case "reopen": {
      const key = requireArg(rest[0], "key");
      await setStatus(key, "REOPENED", values.reason);
      console.log("Overall progress will fall accordingly.");
      break;
    }

    case "complete": {
      const key = requireArg(rest[0], "key");
      const item = await findItem(key);

      const gates = await db
        .select()
        .from(qualityGates)
        .where(eq(qualityGates.workItemId, item.id));
      const children = await db
        .select()
        .from(workItems)
        .where(eq(workItems.parentId, item.id));

      const reasons = blockersToCompletion(
        {
          id: item.id,
          parentId: item.parentId,
          status: item.status,
          weight: item.weight,
          gates: gates.map((gate) => ({ status: gate.status, weight: gate.weight })),
        },
        children.map((child) => ({
          id: child.key,
          parentId: child.parentId,
          status: child.status,
          weight: child.weight,
        })),
      );

      if (reasons.length > 0) {
        console.error(`Refusing to complete ${item.key} — ${item.title}:`);
        for (const reason of reasons) console.error(`  · ${reason}`);
        console.error(
          "\nResolve these first. Marking it complete anyway would make the published " +
            "progress figure a lie (mandate §57).",
        );
        process.exit(1);
      }

      await setStatus(key, "COMPLETED");
      break;
    }

    case "gate": {
      const key = requireArg(rest[0], "key");
      const gateKey = requireArg(rest[1], "gateKey");
      const item = await findItem(key);

      const status = values.pass
        ? "PASSED"
        : values.fail
          ? "FAILED"
          : values.na
            ? "NOT_APPLICABLE"
            : null;
      if (!status) {
        console.error("Specify one of --pass, --fail or --na.");
        process.exit(1);
      }

      const [gate] = await db
        .select()
        .from(qualityGates)
        .where(
          and(eq(qualityGates.workItemId, item.id), eq(qualityGates.key, gateKey)),
        )
        .limit(1);
      if (!gate) {
        console.error(`Gate '${gateKey}' not found on ${item.key}.`);
        process.exit(1);
      }

      await db
        .update(qualityGates)
        .set({
          status,
          evidence: values.evidence ?? gate.evidence,
          checkedAt: new Date(),
        })
        .where(eq(qualityGates.id, gate.id));

      await logEvent(
        `gate.${status.toLowerCase()}`,
        `${item.key} gate '${gate.title}' → ${status}`,
        {
          detail: values.evidence,
          severity: status === "FAILED" ? "ERROR" : status === "PASSED" ? "SUCCESS" : "INFO",
          workItemId: item.id,
        },
      );
      console.log(`${item.key}/${gateKey}: ${gate.status} → ${status}`);
      break;
    }

    case "exec": {
      const itemId = values.item ? (await findItem(values.item)).id : undefined;
      const patch = {
        operation: values.operation ?? null,
        branch: values.branch ?? null,
        commitSha: values.commit ?? null,
        environment: values.env ?? null,
        updatedAt: new Date(),
        ...(itemId ? { currentWorkItemId: itemId } : {}),
      };
      await db
        .insert(executionState)
        .values({ projectId, ...patch })
        .onConflictDoUpdate({ target: executionState.projectId, set: patch });
      console.log("Execution state updated.");
      break;
    }

    case "event": {
      const itemId = values.item ? (await findItem(values.item)).id : undefined;
      await logEvent(values.type ?? "note", requireArg(values.title, "--title"), {
        detail: values.detail,
        severity: (values.severity?.toUpperCase() as "INFO") ?? "INFO",
        workItemId: itemId,
      });
      console.log("Event recorded.");
      break;
    }

    case "deploy": {
      await db.insert(deployments).values({
        projectId,
        environment: requireArg(values.env, "--env"),
        provider: "vercel",
        target: values.target ?? "control-center",
        url: values.url ?? null,
        commitSha: values.commit ?? null,
        status: (values.status?.toUpperCase() as "READY") ?? "READY",
      });
      await logEvent("deployment.created", `Deployed ${values.target ?? "control-center"} to ${values.env}`, {
        detail: values.url,
        severity: "SUCCESS",
      });
      console.log("Deployment recorded.");
      break;
    }

    case "report": {
      const items = await db
        .select()
        .from(workItems)
        .where(eq(workItems.projectId, projectId));
      const gates = await db.select().from(qualityGates);
      const gatesByItem = new Map<string, { status: (typeof gates)[number]["status"]; weight: number }[]>();
      for (const gate of gates) {
        const bucket = gatesByItem.get(gate.workItemId);
        const entry = { status: gate.status, weight: gate.weight };
        if (bucket) bucket.push(entry);
        else gatesByItem.set(gate.workItemId, [entry]);
      }

      const inputs: WorkItemInput[] = items.map((item) => ({
        id: item.id,
        parentId: item.parentId,
        status: item.status,
        weight: item.weight,
        gates: gatesByItem.get(item.id),
      }));

      console.log(`\nSLATE — overall progress: ${toPercent(overallProgress(inputs))}%`);
      console.log(`${items.length} work items, ${gates.length} quality gates.\n`);

      const recent = await db
        .select()
        .from(activityEvents)
        .where(eq(activityEvents.projectId, projectId))
        .orderBy(desc(activityEvents.createdAt))
        .limit(5);
      if (recent.length > 0) {
        console.log("Recent activity:");
        for (const event of recent) console.log(`  · ${event.title}`);
      }
      break;
    }

    default:
      console.error(`Unknown command '${command}'.`);
      console.log(USAGE);
      process.exit(1);
  }

  process.exit(0);
}

function requireArg(value: string | undefined, name: string): string {
  if (!value) {
    console.error(`Missing required argument: ${name}`);
    process.exit(1);
  }
  return value;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
