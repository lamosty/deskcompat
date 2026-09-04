# DeskCompat product brief

## Status

DeskCompat is **pre-alpha**. Its current product boundary is read-only discovery,
diagnosis, and planning. The interfaces and file formats described below are a
direction, not a compatibility promise, and no system-changing command should be
considered supported yet.

## One-sentence position

DeskCompat is **macOS muscle-memory compatibility for Ubuntu GNOME**: a modular,
safety-first way to make selected desktop behaviors familiar while preserving an
already-customized Linux system.

## Product thesis

Moving between macOS and Linux is less painful when familiar actions continue to
produce familiar results. Today, achieving that usually means combining keyboard
remappers, GNOME settings and extensions, gesture tools, startup services, and
one-off scripts. Each piece can work, but their ownership and interactions are
rarely modeled as a whole.

The opportunity is not to invent another remapper. It is to provide a control
plane for desktop behavior that can:

1. adopt a machine as it exists rather than assuming a clean install;
2. express user intent as independently selectable capabilities;
3. compare intent with observed state;
4. generate an explicit, deterministic change plan;
5. change only approved and owned state; and
6. verify, report drift, and undo conservatively.

The dated [project landscape](landscape.md) records the adjacent tools we expect to
reuse, detect, or deliberately avoid duplicating.

## Initial audience

### Primary

Developers and technical creators who use Ubuntu GNOME but retain macOS muscle
memory, especially people who switch between a Mac and Linux during the same week.
They often already have partial customizations and do not want an opinionated
bootstrap script to replace them.

### Secondary

- Linux support or platform engineers who maintain a repeatable workstation
  experience for a small team;
- advanced users who want an auditable alternative to a personal pile of scripts;
  and
- AI-assisted users who need machine-readable discovery and bounded operations
  rather than unconstrained shell instructions.

## User promise

**Keep your Mac habits on Ubuntu—without replacing your setup.**

The promise is intentionally narrower than “make Linux into macOS.” DeskCompat
targets interaction compatibility, not operating-system identity or visual cloning.

## Product wedge

DeskCompat should grow through small, high-confidence slices on current Ubuntu
GNOME releases, in this order:

- inspection of overlapping settings, remappers, extensions, and services;
- user-level GNOME workspace and window-control settings;
- protected keyboard modifier and application-shortcut behavior; and
- pointer and gesture compatibility only after recovery is proven for input.

This scope is large enough to demonstrate coordination and rollback, but small
enough to test across a real compatibility matrix.

## Capability model

A profile describes desired behavior, not a pile of commands. Users should be able
to enable, disable, or override capabilities independently. Possible capability
groups include:

| Group | Examples | Initial priority |
| --- | --- | --- |
| Workspaces | count, monitor policy, switching conventions | First mutation slice |
| Window controls | button placement and related GNOME settings | First mutation slice |
| Keyboard | modifier roles, common editing shortcuts, app exceptions | Protected v0.1 slice |
| Pointer and gestures | workspace swipes, overview gesture, button behavior | Candidate v0.2 slice |
| Windows | movement and broader management conventions | Later |
| Applications | narrowly scoped compatibility exceptions | Later |
| Appearance | dock/theme/icon preferences | Optional, later |

Capabilities must declare their dependencies and conflicts. A profile must not
silently enable an adjacent capability merely because the author prefers it.

## Intended lifecycle

The lifecycle below is the target product model. `Inspect`, profile validation, and
`Plan` exist in the current read-only CLI; the remaining stages are not available:

1. **Inspect** — collect relevant system facts without mutation.
2. **Compare** — resolve a selected profile against observed state and support.
3. **Plan** — show exact proposed changes, conflicts, privilege boundaries, and
   recovery information.
4. **Apply** — after explicit approval, snapshot owned targets and execute guarded
   changes in a deterministic order.
5. **Verify** — re-read state and report success, partial success, or drift.
6. **Undo** — restore only state that can still be attributed safely to the
   corresponding apply operation.

Inspection and planning should remain useful even for users who never permit
DeskCompat to apply changes.

## Safety contract

Safety is the main product differentiation, not a disclaimer added after the fact.
The implementation should uphold these rules before mutation is offered:

### Read-only by default

Running discovery or generating a plan must not modify packages, target configuration
resources or files, extensions, services, or session state. Future plan persistence
may write DeskCompat-owned application state, but a target mutation requires an
explicit operation and a reviewable plan.

### Preconditions, not assumptions

Every planned write records the state it expects to replace. If that state changes
before apply, DeskCompat stops or replans instead of forcing the stale value.

### Explicit ownership

DeskCompat records which targets and values it changed. It does not claim ownership
of an entire settings database, configuration directory, or user session merely
because it touched one key.

### Recoverable records

An apply operation retains relevant prior values, operation order, tool versions,
and verification results. Sensitive values must not be copied into logs merely to
make a record complete.

### Conservative undo

Undo restores a prior value only when the current value still matches the state
DeskCompat set, unless the user explicitly resolves the conflict. This avoids
overwriting later manual edits. Recovery is best-effort: external tools, upgrades,
and user actions mean universal rollback cannot be guaranteed.

### Bounded privilege

Inspection should be unprivileged wherever possible. A plan identifies privileged
steps before approval, and an eventual agent interface must not bypass the host's
normal authentication and authorization boundaries.

### Idempotence and verification

Reapplying the same intent should converge rather than accumulate duplicate
configuration. Each operation needs a postcondition that can be checked using the
same adapters used for inspection.

### Unsupported means no change

Unknown versions, ambiguous ownership, incompatible sessions, and unmodeled tools
produce diagnostics—not optimistic writes.

## Existing customization is a first-class case

The most important test machine is not a fresh virtual machine. It is a daily-use
desktop with shortcuts, extensions, daemons, and hand-edited files already in
place. Inspection should classify relevant state as:

- already compatible;
- compatible and owned elsewhere;
- conflicting with the requested behavior;
- unsupported or ambiguous; or
- safe for DeskCompat to manage after approval.

Adoption must be explicit. Discovering a matching value does not automatically
prove that DeskCompat owns it or may undo it later.

## Human and agent interfaces

The CLI should be the canonical automation boundary. Human-readable output is
important, while a versioned structured-output mode should expose the same facts,
plans, warnings, and operation identifiers without requiring an agent to scrape
terminal prose.

An MCP server may later provide discoverable tools for inspection, planning,
application, status, and undo. It should remain a thin adapter over the same core
engine and safety policy rather than a privileged parallel implementation.

Commands are sufficient for the early project. MCP becomes valuable only when the
schema and confirmation semantics are stable. Agent convenience must not weaken
approval, privilege, conflict, or ownership rules.

## Compatibility policy

Support should be declared as tested combinations rather than inferred from the
word “Linux.” The initial matrix should identify at least:

- Ubuntu release;
- GNOME Shell version;
- X11 or Wayland session;
- input stack and relevant device class;
- required external component versions; and
- known conflicts.

Additional Linux distributions, desktop environments, and behavior profiles should
arrive through explicit adapters after the Ubuntu GNOME core is dependable.

## Roadmap

### Phase 0 — read-only foundation

- Specify capabilities and observed-state schemas.
- Inventory relevant GNOME settings, extensions, remappers, gesture tools, and
  user services.
- Produce useful diagnostics without requiring a profile or changing the host.

### Phase 1 — deterministic planning

- Add the narrow macOS-muscle-memory profile.
- Resolve profile intent against observed state.
- Explain dependencies, conflicts, unsupported cases, and prospective ownership.
- Provide versioned structured output and fixture-driven tests.

### Phase 2 — guarded application

- Implement the smallest reversible operations first.
- Store operation records and preconditions.
- Require explicit capability selection and plan approval.
- Verify every change and stop safely on mismatch.

### Phase 3 — recovery and drift

- Add conservative undo with conflict reporting.
- Detect changes made outside DeskCompat without automatically “fixing” them.
- Test upgrades and failure recovery across the supported matrix.

### Phase 4 — stable automation

- Stabilize the CLI contract.
- Evaluate a thin MCP adapter with the same authorization model.
- Document safe integration patterns for local agents and workstation management.

### Later, based on evidence

- Additional profiles, distributions, or desktop environments.
- Carefully bounded appearance capabilities.
- Community adapters that meet the same inspection, ownership, and undo contract.

## Non-goals

- Reproducing macOS visually or behaviorally in every detail.
- Shipping a Linux distribution, desktop environment, or mandatory toolchain.
- Replacing focused projects such as input remappers or GNOME extensions.
- Managing arbitrary dotfiles, packages, or system hardening.
- Treating a new installation as the only supported starting state.
- Applying “recommended” changes without the user's capability choices.
- Hiding commands, privileges, side effects, or conflicts to create a one-click demo.
- Guaranteeing perfect rollback after third-party or manual interference.
- Supporting every Linux desktop through untested best guesses.

## Measures of success

Before broadening scope, DeskCompat should demonstrate that:

- inspection makes no relevant persistent changes in automated tests;
- identical inputs produce an identical plan;
- unsupported or ambiguous state fails closed;
- each supported mutation has a verified recovery path;
- undo preserves unrelated edits and surfaces conflicts;
- users can omit any optional capability without surprising side effects; and
- a customized daily-use Ubuntu GNOME system can adopt the supported profile
  without being reset to a project-maintained baseline.
