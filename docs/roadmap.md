# DeskCompat roadmap

## Product direction

DeskCompat begins as a safe manager for one real macOS-style Ubuntu GNOME setup. The
reference machine is a canary, not the public schema. Each customization is classified
as portable behaviour, personal preference, machine-local hardware binding,
infrastructure-specific state, or unmanaged state.

The product expands only after a narrow workflow is deterministic, reversible where
the underlying resource permits, and usable by people other than its author.

## v0.1: Ubuntu GNOME foundation

### Milestone 1: deterministic read-only planner

- Establish the strict Bun/TypeScript workspace and CI.
- Define runtime schemas, canonical JSON, operation IDs, and diagnostics.
- Inspect Ubuntu 24.04, GNOME 46, Wayland, required tools, and conflicts.
- Resolve the built-in macOS essentials profile, which currently manages window
  controls and explicitly leaves workspaces and keyboard input unmanaged.
- Implement `doctor`, `profile validate`, and `plan` with versioned JSON output.
- Record an ADR selecting or rejecting keyd/Toshy integration for application-aware
  keyboard behaviour.

Exit criteria:

- Unchanged state produces the same semantic plan and digest repeatedly.
- Unsupported systems produce blockers and no mutating plan.
- The milestone contains no system-writing command.

### Milestone 2: transactional user-level GNOME slice

Implementation is complete on `main`; field validation and the adoption gates below
remain open before it is described as supported.

- [x] Add immutable plan storage, locking, journals, ownership, and recovery blobs.
- [x] Implement the allowlisted GSettings/dconf driver.
- [x] Add `apply`, `status`, `history`, `revert`, and `recover`.
- [x] Manage only the workspaces and window-control resources selected in the profile.
- [ ] Complete process-crash/power-loss fault injection beyond in-process failure hooks.

Exit criteria:

- A second apply is a no-op.
- Revert preserves unset-versus-explicit GNOME values.
- External changes are never silently overwritten.
- Every injected interruption either recovers or reports recovery required accurately.

### Milestone 3: protected keyboard slice

- Add a semantic keyboard model and deterministic renderer for the selected backend.
- Detect existing input remappers and overlapping configuration.
- Add the narrow admin protocol, root-owned journal, package policy, and recovery units.
- Implement input trial, confirmation, timeout restoration, and boot recovery.
- Test malformed requests, stale state, activation failures, crashes, and reboots.
- Complete a physical keyboard release checklist, including AltGr/international input.

Exit criteria:

- The helper has no arbitrary write, command, path, or service primitive.
- Existing non-DeskCompat configuration is not overwritten.
- Timeout, process failure, and reboot during a trial restore the previous input state.
- Clean install, apply, confirm, repeat apply, revert, recover, and uninstall all pass on
  the declared platform.
- There is no known unrecovered keyboard lockout.

These three milestones form the v0.1 alpha. Packages are prerequisites or package-level
dependencies; they are not part of the DeskCompat apply transaction.

## v0.2: repeatable use beyond the reference machine

Candidate work, ordered by evidence from users:

- Guided device discovery with machine-local hardware bindings.
- Mouse side-button/workspace behaviour after evdev permission and hotplug safety tests.
- Terminal, dock, overview, and optional [Kukni](https://github.com/lamosty/kukni)
  integration. Kukni is a separately maintained Linux file-preview project, not a
  DeskCompat dependency.
- Redacted import/export for known supported resources.
- Profile/schema migrations and tested application upgrades.
- A second Ubuntu/GNOME version only with the complete support matrix.
- Agent usage guidance and, if shell-less clients need it, read-only stdio MCP.

v0.2 remains data-only: no dynamic plugins, community shell hooks, privileged extension
API, or continuous reconciliation daemon.

## v1: stable product contract

v1 means stability for a documented Ubuntu/GNOME matrix, not universal desktop support.
It requires:

- stable profile and JSON CLI contracts with migrations;
- durable journal and managed-state upgrade compatibility;
- documented install, update, disable, revert, recover, and uninstall semantics;
- a reviewed privileged protocol and security model;
- continuously tested supported-platform combinations;
- a sustainable compatibility and release policy.

A public declarative profile schema may combine existing allowlisted capabilities at
v1. Mutating MCP is optional and must use the same immutable-plan path if added.

## Extension timing

Before v1, all modules and adapters are compiled in and reviewed with core. This is
intentional: a useful abstraction should be extracted from multiple implementations,
not invented in advance.

A public adapter SDK is considered only when:

- at least two real backends implement the proposed boundary;
- at least three integrations need the same interface;
- external maintainers are prepared to own those integrations; and
- the boundary does not create a generic privileged execution mechanism.

Privileged third-party plugins are not planned. A Windows-like profile on Ubuntu may
eventually reuse existing declarative capabilities. macOS-host support has different
APIs and authorization and should be evaluated as a separate package or project.

## Adoption and quality gates

Stars and download counts are not release gates. Useful evidence includes:

- the owner manages the covered modules exclusively through DeskCompat for 30 days;
- 3–5 external users complete the v0.1 flow without maintainer shell intervention;
- 10–20 independent installs across several hardware combinations precede v1;
- at least 90% of supported beta installs complete without maintainer intervention;
- repeat apply has no unintended operations;
- no unrecovered input lockout or silent state loss occurs;
- most testers reach useful behaviour in under ten minutes;
- opt-in tester feedback shows continued use after 30 days;
- the declared matrix remains maintainable by available maintainers.

There is no default telemetry. Diagnostics shared for support must be generated
explicitly, redacted, and reviewable by the user.

## Stop, narrow, or pivot criteria

DeskCompat should remain a personal/reference project or pivot upstream when:

- an existing project provides most required behaviour and can accept the missing safe
  orchestration more cheaply than a new framework;
- external users consistently want only a profile or installer, not ongoing managed
  state;
- after a public beta and deliberate outreach, no users beyond the owner complete and
  retain the workflow;
- each new platform requires largely separate core logic or unsustainable maintenance;
- a requested extension model requires arbitrary root scripts;
- deterministic recovery for input changes cannot be demonstrated.

Any unrecovered lockout, privilege-boundary escape, or silent overwrite is a release
blocker until its root cause and adjacent paths are addressed.
