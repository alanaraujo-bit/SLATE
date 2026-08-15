import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  real,
  timestamp,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * Roadmap status vocabulary — fixed by mandate §22.
 *
 * These are not arbitrary labels: `progress.ts` maps them to completion
 * fractions, so adding a value here without deciding its fraction will
 * silently distort overall progress.
 */
export const workStatus = pgEnum("work_status", [
  "PLANNED",
  "READY",
  "IN_PROGRESS",
  "TESTING",
  "VALIDATING",
  "BLOCKED_EXTERNAL",
  "OPERATOR_REQUIRED",
  "COMPLETED",
  "REOPENED",
]);

/**
 * Depth in the roadmap tree. Modelled as a column on a single self-referential
 * table rather than five parallel tables: drill-down, dependency edges, and
 * recursive progress then have exactly one implementation instead of five, and
 * inserting a new level later costs nothing.
 */
export const workKind = pgEnum("work_kind", [
  "PHASE",
  "MILESTONE",
  "FEATURE",
  "TASK",
  "SUBTASK",
]);

export const gateStatus = pgEnum("gate_status", [
  "PENDING",
  "PASSED",
  "FAILED",
  "NOT_APPLICABLE",
]);

export const operatorActionStatus = pgEnum("operator_action_status", [
  "OPEN",
  "IN_PROGRESS",
  "RESOLVED",
  "WONT_DO",
]);

export const deploymentStatus = pgEnum("deployment_status", [
  "PENDING",
  "BUILDING",
  "READY",
  "ERROR",
  "CANCELED",
]);

export const activitySeverity = pgEnum("activity_severity", [
  "INFO",
  "SUCCESS",
  "WARNING",
  "ERROR",
]);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  version: text("version").notNull().default("0.1.0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workItems = pgTable(
  "work_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => workItems.id, {
      onDelete: "cascade",
    }),
    kind: workKind("kind").notNull(),
    /** Stable human-readable identifier, e.g. "P1-M2-T04". Used by the CLI. */
    key: text("key").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: workStatus("status").notNull().default("PLANNED"),
    /**
     * Relative weight among siblings. Progress rolls up as a weighted mean, so
     * a milestone worth three times another simply carries weight 3.
     */
    weight: real("weight").notNull().default(1),
    position: integer("position").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("work_items_project_key_idx").on(t.projectId, t.key),
    index("work_items_parent_idx").on(t.parentId),
    index("work_items_status_idx").on(t.status),
  ],
);

/**
 * A quality gate is the unit of truth about doneness (§31). A work item may not
 * be COMPLETED while any of its gates is PENDING or FAILED — enforced in
 * `progress.ts` and by the CLI, not merely by convention.
 */
export const qualityGates = pgTable(
  "quality_gates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    status: gateStatus("status").notNull().default("PENDING"),
    weight: real("weight").notNull().default(1),
    /** How the gate was verified — a URL, a test run, a commit. */
    evidence: text("evidence"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("quality_gates_item_key_idx").on(t.workItemId, t.key)],
);

export const dependencies = pgTable(
  "dependencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    dependsOnId: uuid("depends_on_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("dependencies_pair_idx").on(t.workItemId, t.dependsOnId)],
);

export const activityEvents = pgTable(
  "activity_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id").references(() => workItems.id, {
      onDelete: "set null",
    }),
    type: text("type").notNull(),
    severity: activitySeverity("severity").notNull().default("INFO"),
    title: text("title").notNull(),
    detail: text("detail"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activity_events_created_idx").on(t.createdAt)],
);

export const operatorActions = pgTable("operator_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  status: operatorActionStatus("status").notNull().default("OPEN"),
  /** False for a feature-scoped dependency, true only for a true project halt. */
  projectBlocked: boolean("project_blocked").notNull().default(false),
  impact: text("impact"),
  blocks: text("blocks"),
  why: text("why"),
  whatToDo: text("what_to_do"),
  howToValidate: text("how_to_validate"),
  alreadyCompleted: text("already_completed"),
  whatHappensAfter: text("what_happens_after"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const deployments = pgTable(
  "deployments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    environment: text("environment").notNull(),
    provider: text("provider").notNull(),
    target: text("target").notNull(),
    url: text("url"),
    commitSha: text("commit_sha"),
    status: deploymentStatus("status").notNull().default("PENDING"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("deployments_created_idx").on(t.createdAt)],
);

/**
 * Singleton row per project describing what is happening *right now* (§24).
 */
export const executionState = pgTable("execution_state", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  currentWorkItemId: uuid("current_work_item_id").references(() => workItems.id, {
    onDelete: "set null",
  }),
  operation: text("operation"),
  branch: text("branch"),
  commitSha: text("commit_sha"),
  environment: text("environment"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WorkItem = typeof workItems.$inferSelect;
export type QualityGate = typeof qualityGates.$inferSelect;
export type ActivityEvent = typeof activityEvents.$inferSelect;
export type OperatorAction = typeof operatorActions.$inferSelect;
export type Deployment = typeof deployments.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type WorkStatus = (typeof workStatus.enumValues)[number];
export type WorkKind = (typeof workKind.enumValues)[number];
export type GateStatus = (typeof gateStatus.enumValues)[number];
