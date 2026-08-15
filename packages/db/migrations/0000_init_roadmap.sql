CREATE TYPE "public"."activity_severity" AS ENUM('INFO', 'SUCCESS', 'WARNING', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."deployment_status" AS ENUM('PENDING', 'BUILDING', 'READY', 'ERROR', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."gate_status" AS ENUM('PENDING', 'PASSED', 'FAILED', 'NOT_APPLICABLE');--> statement-breakpoint
CREATE TYPE "public"."operator_action_status" AS ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_DO');--> statement-breakpoint
CREATE TYPE "public"."work_kind" AS ENUM('PHASE', 'MILESTONE', 'FEATURE', 'TASK', 'SUBTASK');--> statement-breakpoint
CREATE TYPE "public"."work_status" AS ENUM('PLANNED', 'READY', 'IN_PROGRESS', 'TESTING', 'VALIDATING', 'BLOCKED_EXTERNAL', 'OPERATOR_REQUIRED', 'COMPLETED', 'REOPENED');--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"work_item_id" uuid,
	"type" text NOT NULL,
	"severity" "activity_severity" DEFAULT 'INFO' NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"depends_on_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"provider" text NOT NULL,
	"target" text NOT NULL,
	"url" text,
	"commit_sha" text,
	"status" "deployment_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_state" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"current_work_item_id" uuid,
	"operation" text,
	"branch" text,
	"commit_sha" text,
	"environment" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"status" "operator_action_status" DEFAULT 'OPEN' NOT NULL,
	"project_blocked" boolean DEFAULT false NOT NULL,
	"impact" text,
	"blocks" text,
	"why" text,
	"what_to_do" text,
	"how_to_validate" text,
	"already_completed" text,
	"what_happens_after" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "operator_actions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"version" text DEFAULT '0.1.0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "quality_gates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"status" "gate_status" DEFAULT 'PENDING' NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"evidence" text,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"parent_id" uuid,
	"kind" "work_kind" NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "work_status" DEFAULT 'PLANNED' NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependencies" ADD CONSTRAINT "dependencies_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependencies" ADD CONSTRAINT "dependencies_depends_on_id_work_items_id_fk" FOREIGN KEY ("depends_on_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_state" ADD CONSTRAINT "execution_state_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_state" ADD CONSTRAINT "execution_state_current_work_item_id_work_items_id_fk" FOREIGN KEY ("current_work_item_id") REFERENCES "public"."work_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_actions" ADD CONSTRAINT "operator_actions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_gates" ADD CONSTRAINT "quality_gates_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_parent_id_work_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_created_idx" ON "activity_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dependencies_pair_idx" ON "dependencies" USING btree ("work_item_id","depends_on_id");--> statement-breakpoint
CREATE INDEX "deployments_created_idx" ON "deployments" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quality_gates_item_key_idx" ON "quality_gates" USING btree ("work_item_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "work_items_project_key_idx" ON "work_items" USING btree ("project_id","key");--> statement-breakpoint
CREATE INDEX "work_items_parent_idx" ON "work_items" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "work_items_status_idx" ON "work_items" USING btree ("status");