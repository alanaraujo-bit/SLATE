import type { GateStatus, WorkKind, WorkStatus } from "./schema";

/**
 * The SLATE roadmap.
 *
 * This is the plan of record (mandate §21, §54). It is seeded into Postgres and
 * thereafter mutated by the roadmap CLI as work proceeds — this file is the
 * *initial* decomposition, not a mirror of live state. Re-seeding is additive
 * and never overwrites a status the CLI has advanced.
 *
 * Weights express relative engineering size among siblings, not duration.
 */

export interface SeedGate {
  key: string;
  title: string;
  status?: GateStatus;
  weight?: number;
  evidence?: string;
}

export interface SeedItem {
  key: string;
  kind: WorkKind;
  title: string;
  description?: string;
  status?: WorkStatus;
  weight?: number;
  gates?: SeedGate[];
  children?: SeedItem[];
  /** Keys of items that must complete first. */
  dependsOn?: string[];
}

/** The universal quality gate set from mandate §31, in its applicable subset. */
const g = (key: string, title: string, status: GateStatus = "PENDING"): SeedGate => ({
  key,
  title,
  status,
});

export const PROJECT = {
  slug: "slate",
  name: "SLATE",
  description:
    "Turn any phone or tablet into an intelligent, contextual control surface for your computer.",
  version: "0.1.0",
};

export const ROADMAP: SeedItem[] = [
  {
    key: "P0",
    kind: "PHASE",
    title: "Foundation & Project Intelligence",
    description:
      "Understand the product, settle the architecture, stand up cloud infrastructure, and build the instrument that tracks everything else.",
    weight: 1,
    children: [
      {
        key: "P0-M1",
        kind: "MILESTONE",
        title: "Project intelligence & architecture",
        description:
          "Research the real constraints — browser limitations above all — and record the decisions they force.",
        weight: 2,
        children: [
          {
            key: "P0-M1-T1",
            kind: "TASK",
            title: "Validate transport feasibility against browser constraints",
            description:
              "Determine whether an HTTPS PWA can reach a desktop agent at all. Establishes mixed content, certificate, and Local Network Access constraints.",
            gates: [
              g("research", "Current browser behaviour researched", "PASSED"),
              g("adr", "Decision recorded as ADR", "PASSED"),
            ],
          },
          {
            key: "P0-M1-T2",
            kind: "TASK",
            title: "Define system architecture and repository shape",
            gates: [g("adr", "ADR-0001 written", "PASSED")],
          },
          {
            key: "P0-M1-T3",
            kind: "TASK",
            title: "Verify the Rust/MSVC toolchain for Tauri",
            description:
              "Confirm the linker resolves before committing the Desktop Agent to Tauri.",
            gates: [g("build", "Hello-world Rust binary links", "PASSED")],
          },
          {
            key: "P0-M1-T4",
            kind: "TASK",
            title: "Specify the security model",
            description:
              "Device identity, pairing handshake, capability scopes, token lifetime, revocation.",
            gates: [g("adr", "ADR-0004 written"), g("review", "Threat model reviewed")],
          },
          {
            key: "P0-M1-T5",
            kind: "TASK",
            title: "Specify the protocol and its versioning strategy",
            description:
              "Transport-agnostic message contracts, capability negotiation, version mismatch behaviour (§38).",
            gates: [g("adr", "ADR-0003 written"), g("schema", "Schemas defined in code")],
          },
        ],
      },
      {
        key: "P0-M2",
        kind: "MILESTONE",
        title: "Repository & cloud infrastructure",
        description:
          "Monorepo, GitHub as source of truth, Railway Postgres across two environments.",
        weight: 1,
        children: [
          {
            key: "P0-M2-T1",
            kind: "TASK",
            title: "Initialise monorepo and push to GitHub",
            gates: [g("push", "main established on origin", "PASSED")],
          },
          {
            key: "P0-M2-T2",
            kind: "TASK",
            title: "Provision Postgres for staging and production",
            gates: [
              g("provisioned", "Both environments online", "PASSED"),
              g("migrated", "Schema applied to both", "PASSED"),
            ],
          },
          {
            key: "P0-M2-T3",
            kind: "TASK",
            title: "Author CI pipeline",
            description:
              "Typecheck, lint, unit and E2E against preview deployments. Activation waits on ACTION-001.",
            status: "OPERATOR_REQUIRED",
            gates: [
              g("authored", "Workflow definitions written"),
              g("active", "Pipeline running on push"),
            ],
          },
        ],
      },
      {
        key: "P0-M3",
        kind: "MILESTONE",
        title: "Development Control Center (Roadmap Live)",
        description:
          "A real deployed application showing computed progress, current execution, activity, gates, blockers and operator actions — updating without a refresh.",
        weight: 3,
        children: [
          {
            key: "P0-M3-T1",
            kind: "TASK",
            title: "Roadmap data model and progress engine",
            description:
              "Recursive work item tree, quality gates, computed progress that cannot be inflated.",
            gates: [
              g("schema", "Schema migrated to cloud", "PASSED"),
              g("tests", "Progress rules unit tested", "PASSED"),
            ],
          },
          {
            key: "P0-M3-T2",
            kind: "TASK",
            title: "Roadmap CLI write path",
            description:
              "Programmatic state mutation so execution updates the roadmap without editing a page (§24).",
            gates: [g("cli", "Commands implemented"), g("tests", "Covered by tests")],
          },
          {
            key: "P0-M3-T3",
            kind: "TASK",
            title: "Control Center UI",
            description:
              "Phases, milestones, drill-down, current execution, activity log, gates, operator actions.",
            gates: [
              g("responsive", "Mobile and desktop layouts"),
              g("states", "Loading, empty and error states"),
              g("a11y", "Accessible"),
            ],
          },
          {
            key: "P0-M3-T4",
            kind: "TASK",
            title: "Realtime updates",
            description:
              "Server-sent events with reconnection that never renders as a broken page.",
            gates: [
              g("sse", "Stream delivers updates"),
              g("reconnect", "Survives the platform stream timeout cleanly"),
            ],
          },
          {
            key: "P0-M3-T5",
            kind: "TASK",
            title: "Deploy and validate in cloud",
            gates: [
              g("deployed", "Reachable production URL"),
              g("e2e", "End-to-end tests pass against the deployment"),
            ],
          },
        ],
      },
    ],
  },
  {
    key: "P1",
    kind: "PHASE",
    title: "Core Platform",
    description:
      "The parts every other feature stands on: design language, wire protocol, identity, pairing, and the transport itself.",
    weight: 3,
    children: [
      {
        key: "P1-M1",
        kind: "MILESTONE",
        title: "Design System",
        description:
          "Tokens and primitives for typography, spacing, radii, elevation, motion, semantic colour and interactive states (§47).",
        weight: 2,
        children: [
          { key: "P1-M1-T1", kind: "TASK", title: "Token set and theming strategy" },
          { key: "P1-M1-T2", kind: "TASK", title: "Core primitives and interactive states" },
          { key: "P1-M1-T3", kind: "TASK", title: "Motion and microinteraction vocabulary" },
          { key: "P1-M1-T4", kind: "TASK", title: "Iconography" },
        ],
      },
      {
        key: "P1-M2",
        kind: "MILESTONE",
        title: "Protocol package",
        description:
          "Versioned, transport-agnostic message contracts shared by PWA, Agent and services.",
        weight: 2,
        dependsOn: ["P0-M1-T5"],
        children: [
          { key: "P1-M2-T1", kind: "TASK", title: "Message schemas and validation" },
          { key: "P1-M2-T2", kind: "TASK", title: "Capability negotiation and version mismatch" },
          { key: "P1-M2-T3", kind: "TASK", title: "Contract tests" },
        ],
      },
      {
        key: "P1-M3",
        kind: "MILESTONE",
        title: "Accounts & authentication",
        weight: 2,
        children: [
          { key: "P1-M3-T1", kind: "TASK", title: "Auth provider integration" },
          { key: "P1-M3-T2", kind: "TASK", title: "Account model and session handling" },
          { key: "P1-M3-T3", kind: "TASK", title: "Sign-in, sign-up and recovery flows" },
        ],
      },
      {
        key: "P1-M4",
        kind: "MILESTONE",
        title: "Device identity & secure pairing",
        description:
          "Cryptographic device identity, pairing handshake, capability scopes, revocation (§13).",
        weight: 3,
        dependsOn: ["P1-M3", "P0-M1-T4"],
        children: [
          { key: "P1-M4-T1", kind: "TASK", title: "Device keypair generation and storage" },
          { key: "P1-M4-T2", kind: "TASK", title: "Pairing handshake" },
          { key: "P1-M4-T3", kind: "TASK", title: "Token issuance, rotation and revocation" },
          { key: "P1-M4-T4", kind: "TASK", title: "Security tests: replay, revoked device, invalid auth" },
        ],
      },
      {
        key: "P1-M5",
        kind: "MILESTONE",
        title: "WebRTC transport",
        description:
          "Signaling service, ICE, DataChannel, relay fallback, reconnection.",
        weight: 4,
        dependsOn: ["P1-M4", "P1-M2"],
        children: [
          { key: "P1-M5-T1", kind: "TASK", title: "Signaling service" },
          { key: "P1-M5-T2", kind: "TASK", title: "Browser peer implementation" },
          { key: "P1-M5-T3", kind: "TASK", title: "Agent peer implementation (Rust)" },
          { key: "P1-M5-T4", kind: "TASK", title: "TURN relay fallback" },
          { key: "P1-M5-T5", kind: "TASK", title: "Reconnection and connection state machine" },
          { key: "P1-M5-T6", kind: "TASK", title: "Protocol tests: timeout, duplicate, stale, mismatch" },
        ],
      },
    ],
  },
  {
    key: "P2",
    kind: "PHASE",
    title: "Control Surface",
    description: "The PWA itself — runtime, components, editor, and sync.",
    weight: 3,
    dependsOn: ["P1"],
    children: [
      {
        key: "P2-M1",
        kind: "MILESTONE",
        title: "PWA shell",
        description:
          "Manifest, service worker, offline app shell, installability, safe areas, connection states (§7, §37).",
        weight: 3,
        children: [
          { key: "P2-M1-T1", kind: "TASK", title: "Manifest, icons and installability" },
          { key: "P2-M1-T2", kind: "TASK", title: "Service worker and offline app shell" },
          { key: "P2-M1-T3", kind: "TASK", title: "Connection state surface" },
          { key: "P2-M1-T4", kind: "TASK", title: "Onboarding and pairing flow" },
        ],
      },
      {
        key: "P2-M2",
        kind: "MILESTONE",
        title: "Control component library",
        description:
          "Button, Toggle, Slider, Dial, Gauge, Status, Text, Image, Media, Timer, Counter, Folder, Navigation, Chart, Action Group (§10).",
        weight: 4,
        children: [
          { key: "P2-M2-T1", kind: "TASK", title: "Control contract and state model" },
          { key: "P2-M2-T2", kind: "TASK", title: "Trigger controls" },
          { key: "P2-M2-T3", kind: "TASK", title: "Continuous controls" },
          { key: "P2-M2-T4", kind: "TASK", title: "Display and state controls" },
          { key: "P2-M2-T5", kind: "TASK", title: "Navigation controls" },
        ],
      },
      {
        key: "P2-M3",
        kind: "MILESTONE",
        title: "Deck runtime",
        description: "Layout engine and responsive behaviour across phone and tablet.",
        weight: 3,
        children: [
          { key: "P2-M3-T1", kind: "TASK", title: "Grid and layout engine" },
          { key: "P2-M3-T2", kind: "TASK", title: "Responsive breakpoints and orientation" },
          { key: "P2-M3-T3", kind: "TASK", title: "Page navigation and folders" },
          { key: "P2-M3-T4", kind: "TASK", title: "Render performance budget" },
        ],
      },
      {
        key: "P2-M4",
        kind: "MILESTONE",
        title: "Deck editor",
        weight: 4,
        children: [
          { key: "P2-M4-T1", kind: "TASK", title: "Create, duplicate and delete decks and pages" },
          { key: "P2-M4-T2", kind: "TASK", title: "Placement, reordering and resizing" },
          { key: "P2-M4-T3", kind: "TASK", title: "Control configuration" },
          { key: "P2-M4-T4", kind: "TASK", title: "Action binding" },
        ],
      },
      {
        key: "P2-M5",
        kind: "MILESTONE",
        title: "Cloud sync",
        description: "Decks, layouts, workflows, preferences and context rules (§42).",
        weight: 2,
        children: [
          { key: "P2-M5-T1", kind: "TASK", title: "Sync model and conflict handling" },
          { key: "P2-M5-T2", kind: "TASK", title: "Sync API and persistence" },
        ],
      },
    ],
  },
  {
    key: "P3",
    kind: "PHASE",
    title: "Desktop Agent",
    description: "Where SLATE actually touches Windows.",
    weight: 4,
    dependsOn: ["P1"],
    children: [
      {
        key: "P3-M1",
        kind: "MILESTONE",
        title: "Agent shell and distribution",
        weight: 3,
        children: [
          { key: "P3-M1-T1", kind: "TASK", title: "Tauri application shell" },
          { key: "P3-M1-T2", kind: "TASK", title: "Agent UI: status, pairing, permissions" },
          { key: "P3-M1-T3", kind: "TASK", title: "Windows installer" },
          { key: "P3-M1-T4", kind: "TASK", title: "Auto-start and update mechanism" },
          { key: "P3-M1-T5", kind: "TASK", title: "Logs and diagnostics" },
        ],
      },
      {
        key: "P3-M2",
        kind: "MILESTONE",
        title: "Action Engine",
        description:
          "Extensible executor with sequences, conditions, delays, retries, variables and result reporting (§5).",
        weight: 4,
        children: [
          { key: "P3-M2-T1", kind: "TASK", title: "Action contract and registry" },
          { key: "P3-M2-T2", kind: "TASK", title: "Execution pipeline with feedback to the PWA" },
          { key: "P3-M2-T3", kind: "TASK", title: "Core actions: keyboard, media, launch, focus" },
          { key: "P3-M2-T4", kind: "TASK", title: "Workflow composition and persistence" },
          { key: "P3-M2-T5", kind: "TASK", title: "Permission model for high-risk actions" },
        ],
      },
      {
        key: "P3-M3",
        kind: "MILESTONE",
        title: "Context Engine",
        description:
          "Foreground application and process observation driving automatic profile switching (§4).",
        weight: 4,
        children: [
          { key: "P3-M3-T1", kind: "TASK", title: "Foreground and process observation" },
          { key: "P3-M3-T2", kind: "TASK", title: "Rule evaluation with priority and fallback" },
          { key: "P3-M3-T3", kind: "TASK", title: "Manual override and automatic return" },
          { key: "P3-M3-T4", kind: "TASK", title: "Context transitions in the PWA" },
        ],
      },
      {
        key: "P3-M4",
        kind: "MILESTONE",
        title: "State providers",
        description: "Bidirectional state so the UI reflects the computer (§6).",
        weight: 3,
        children: [
          { key: "P3-M4-T1", kind: "TASK", title: "State broadcast channel" },
          { key: "P3-M4-T2", kind: "TASK", title: "System metrics provider" },
          { key: "P3-M4-T3", kind: "TASK", title: "Media and audio state provider" },
        ],
      },
    ],
  },
  {
    key: "P4",
    kind: "PHASE",
    title: "Verticals",
    description: "The two launch audiences, done well rather than broadly (§39).",
    weight: 3,
    dependsOn: ["P3", "P2"],
    children: [
      {
        key: "P4-M1",
        kind: "MILESTONE",
        title: "Gaming",
        weight: 3,
        children: [
          { key: "P4-M1-T1", kind: "TASK", title: "OBS integration" },
          { key: "P4-M1-T2", kind: "TASK", title: "Audio control" },
          { key: "P4-M1-T3", kind: "TASK", title: "Game detection and profiles" },
          { key: "P4-M1-T4", kind: "TASK", title: "Performance widgets" },
        ],
      },
      {
        key: "P4-M2",
        kind: "MILESTONE",
        title: "Development",
        weight: 3,
        children: [
          { key: "P4-M2-T1", kind: "TASK", title: "Git status and branch awareness" },
          { key: "P4-M2-T2", kind: "TASK", title: "Script runner with permission model" },
          { key: "P4-M2-T3", kind: "TASK", title: "Dev server and port status" },
          { key: "P4-M2-T4", kind: "TASK", title: "Editor integration" },
        ],
      },
      {
        key: "P4-M3",
        kind: "MILESTONE",
        title: "Templates",
        description: "Prebuilt control surfaces that accelerate onboarding (§41).",
        weight: 2,
        children: [
          { key: "P4-M3-T1", kind: "TASK", title: "Template model and application" },
          { key: "P4-M3-T2", kind: "TASK", title: "Launch template set" },
        ],
      },
    ],
  },
  {
    key: "P5",
    kind: "PHASE",
    title: "Commercial Readiness",
    description: "Entitlements, billing, extensibility, and the release audit (§44, §58).",
    weight: 2,
    dependsOn: ["P4"],
    children: [
      {
        key: "P5-M1",
        kind: "MILESTONE",
        title: "Entitlement system",
        description: "Feature access, limits and device counts across tiers. Prices stay configurable.",
        weight: 2,
        children: [
          { key: "P5-M1-T1", kind: "TASK", title: "Entitlement model and enforcement" },
          { key: "P5-M1-T2", kind: "TASK", title: "Tier configuration" },
        ],
      },
      {
        key: "P5-M2",
        kind: "MILESTONE",
        title: "Billing",
        description:
          "Architecture and integration. Real checkout validation depends on operator-provided credentials and will not be marked complete without it (§29).",
        weight: 2,
        children: [
          { key: "P5-M2-T1", kind: "TASK", title: "Billing integration" },
          { key: "P5-M2-T2", kind: "TASK", title: "Subscription lifecycle" },
        ],
      },
      {
        key: "P5-M3",
        kind: "MILESTONE",
        title: "Plugin architecture",
        description: "Manifest, capabilities, permissions and lifecycle (§40).",
        weight: 3,
        children: [
          { key: "P5-M3-T1", kind: "TASK", title: "Plugin manifest and identity" },
          { key: "P5-M3-T2", kind: "TASK", title: "Plugin runtime and permission model" },
          { key: "P5-M3-T3", kind: "TASK", title: "Plugin-contributed actions and widgets" },
        ],
      },
      {
        key: "P5-M4",
        kind: "MILESTONE",
        title: "Release audit",
        description: "Full regression across every surface named in §58.",
        weight: 3,
        children: [
          { key: "P5-M4-T1", kind: "TASK", title: "Security audit" },
          { key: "P5-M4-T2", kind: "TASK", title: "Performance audit" },
          { key: "P5-M4-T3", kind: "TASK", title: "UX audit" },
          { key: "P5-M4-T4", kind: "TASK", title: "Full regression pass" },
        ],
      },
    ],
  },
];
