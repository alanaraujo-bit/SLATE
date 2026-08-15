import { eq, and } from "drizzle-orm";
import { createDb } from "./index";
import {
  projects,
  workItems,
  qualityGates,
  dependencies,
  operatorActions,
  executionState,
} from "./schema";
import { PROJECT, ROADMAP, type SeedItem } from "./roadmap-data";

/**
 * Seeds the roadmap.
 *
 * Idempotent and *additive*: re-running updates descriptive fields (title,
 * description, weight, ordering) but never rewinds a `status` or gate result
 * that execution has already advanced. Re-seeding after two weeks of work must
 * not reset progress to zero — so status is written on insert only.
 */

const OPERATOR_ACTIONS = [
  {
    code: "ACTION-001",
    title: "Grant `workflow` scope to the GitHub CLI token",
    projectBlocked: false,
    impact: "GitHub Actions CI cannot be committed to the repository.",
    blocks: "CI/CD automation only. All development, deployment and cloud validation continue.",
    why:
      "The authenticated gh token carries scopes gist, read:org and repo, but not workflow. " +
      "GitHub rejects any push whose diff touches .github/workflows/**.",
    whatToDo:
      "Run `gh auth refresh -h github.com -s workflow` and approve the browser prompt.",
    howToValidate: "`gh auth status` lists `workflow` among the token scopes.",
    alreadyCompleted:
      "CI workflow definitions are authored and version-controlled under docs/deployment/ci/, " +
      "ready to relocate into .github/workflows/ in a single commit.",
    whatHappensAfter:
      "Typecheck, lint, unit and E2E pipelines run on every push, and roadmap quality gates " +
      "begin reporting automated results.",
  },
  {
    code: "ACTION-002",
    title: "Windows code-signing certificate for the Desktop Agent installer",
    projectBlocked: false,
    impact: "Installers are unsigned; Windows SmartScreen warns on first run.",
    blocks: "Trusted installer distribution only. The Agent builds, installs and runs.",
    why:
      "Authenticode signing requires an OV or EV certificate purchased from a certificate " +
      "authority under the Aionixdev legal entity, with organisation validation. This is a " +
      "commercial purchase that cannot be performed autonomously.",
    whatToDo:
      "Purchase an OV or EV code-signing certificate, complete validation, then store it as " +
      "the GitHub secrets WINDOWS_CERT_BASE64 and WINDOWS_CERT_PASSWORD.",
    howToValidate: "`signtool verify /pa slate-setup.exe` succeeds and the publisher reads Aionixdev.",
    alreadyCompleted:
      "The build and packaging pipeline is authored so signing is a single configuration step.",
    whatHappensAfter:
      "Released installers are trusted, SmartScreen warnings disappear, and auto-update can " +
      "verify signatures.",
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const db = createDb(url);
  console.log(`Seeding roadmap into ${new URL(url).host}`);

  const [project] = await db
    .insert(projects)
    .values(PROJECT)
    .onConflictDoUpdate({
      target: projects.slug,
      set: {
        name: PROJECT.name,
        description: PROJECT.description,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!project) throw new Error("Failed to upsert project");
  const projectId = project.id;

  const idByKey = new Map<string, string>();
  const pendingDeps: Array<{ from: string; to: string }> = [];
  let inserted = 0;
  let updated = 0;

  const walk = async (items: SeedItem[], parentId: string | null) => {
    for (const [index, item] of items.entries()) {
      const existing = await db
        .select({ id: workItems.id })
        .from(workItems)
        .where(and(eq(workItems.projectId, projectId), eq(workItems.key, item.key)))
        .limit(1);

      let id: string;

      if (existing[0]) {
        id = existing[0].id;
        // Descriptive fields refresh; status deliberately does not.
        await db
          .update(workItems)
          .set({
            parentId,
            kind: item.kind,
            title: item.title,
            description: item.description ?? null,
            weight: item.weight ?? 1,
            position: index,
            updatedAt: new Date(),
          })
          .where(eq(workItems.id, id));
        updated += 1;
      } else {
        const [row] = await db
          .insert(workItems)
          .values({
            projectId,
            parentId,
            kind: item.kind,
            key: item.key,
            title: item.title,
            description: item.description ?? null,
            status: item.status ?? "PLANNED",
            weight: item.weight ?? 1,
            position: index,
          })
          .returning({ id: workItems.id });
        if (!row) throw new Error(`Failed to insert ${item.key}`);
        id = row.id;
        inserted += 1;
      }

      idByKey.set(item.key, id);

      for (const gate of item.gates ?? []) {
        const existingGate = await db
          .select({ id: qualityGates.id })
          .from(qualityGates)
          .where(and(eq(qualityGates.workItemId, id), eq(qualityGates.key, gate.key)))
          .limit(1);

        if (existingGate[0]) {
          // Title may be reworded; a recorded result is never overwritten.
          await db
            .update(qualityGates)
            .set({ title: gate.title, weight: gate.weight ?? 1 })
            .where(eq(qualityGates.id, existingGate[0].id));
        } else {
          await db.insert(qualityGates).values({
            workItemId: id,
            key: gate.key,
            title: gate.title,
            status: gate.status ?? "PENDING",
            weight: gate.weight ?? 1,
            evidence: gate.evidence ?? null,
            checkedAt: gate.status && gate.status !== "PENDING" ? new Date() : null,
          });
        }
      }

      for (const dep of item.dependsOn ?? []) {
        pendingDeps.push({ from: item.key, to: dep });
      }

      if (item.children?.length) {
        await walk(item.children, id);
      }
    }
  };

  await walk(ROADMAP, null);

  for (const dep of pendingDeps) {
    const from = idByKey.get(dep.from);
    const to = idByKey.get(dep.to);
    if (!from || !to) {
      console.warn(`Skipping dependency ${dep.from} -> ${dep.to}: unknown key`);
      continue;
    }
    await db
      .insert(dependencies)
      .values({ workItemId: from, dependsOnId: to })
      .onConflictDoNothing();
  }

  for (const action of OPERATOR_ACTIONS) {
    await db
      .insert(operatorActions)
      .values({ projectId, ...action })
      .onConflictDoUpdate({
        target: operatorActions.code,
        set: {
          title: action.title,
          impact: action.impact,
          blocks: action.blocks,
          why: action.why,
          whatToDo: action.whatToDo,
          howToValidate: action.howToValidate,
          alreadyCompleted: action.alreadyCompleted,
          whatHappensAfter: action.whatHappensAfter,
        },
      });
  }

  await db
    .insert(executionState)
    .values({ projectId, operation: "Seeding roadmap", branch: "main" })
    .onConflictDoNothing();

  console.log(
    `Roadmap seeded: ${inserted} inserted, ${updated} refreshed, ` +
      `${pendingDeps.length} dependencies, ${OPERATOR_ACTIONS.length} operator actions.`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
