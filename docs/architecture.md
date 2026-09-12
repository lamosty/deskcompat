# DeskCompat architecture

## Status

This document defines the target architecture for the first DeskCompat release. The
current pre-alpha implements runtime schemas, platform inspection, module resolution,
ownership-aware planning, and the user-level scalar GNOME transaction lifecycle.
The privileged input helper described below remains a future milestone.

DeskCompat v0.1 targets Ubuntu 24.04, GNOME 46, and Wayland. It provides a narrow,
deterministic engine for applying selected macOS-style desktop behaviours. Broader
platform and profile support is deliberately deferred.

## Goals

- Let users select individual behaviour modules rather than install an all-or-nothing
  desktop makeover.
- Produce an immutable, reviewable plan before changing the system.
- Apply only allowlisted operations with explicit ownership and preconditions.
- Detect drift and refuse to overwrite changes DeskCompat did not make.
- Recover predictably from interrupted work and input configuration failures.
- Expose stable, versioned JSON so humans, scripts, and AI agents use the same engine.

## Non-goals for v0.1

- A universal Linux configuration framework.
- Visual themes, fonts, wallpapers, or Apple assets.
- Arbitrary commands, templates, post-install hooks, or third-party executable plugins.
- Package-manager transactions.
- A daemon that continuously forces desired state.
- MCP, a GUI, other desktop environments, or macOS as a host.
- A claim that changes across GNOME, files, services, and input are atomic.

## System shape

```text
profile.toml
     |
     v
profile parser -> platform inspector -> module resolver -> planner
                                                       |
                                                       v
                                                immutable plan
                                                       |
                           +---------------------------+------------------+
                           |                                              |
                           v                                              v
                 user resource drivers                           admin helper
                 (dconf/GSettings,                         (only named privileged
                  owned user files)                         input operations)
                           |                                              |
                           +-------------------+--------------------------+
                                               v
                                  journal + ownership index
```

The CLI coordinates the workflow. Product modules describe intent. Resource drivers
inspect and change one resource kind. The privileged helper is a separate executable
with a much smaller protocol than the CLI.

## Repository boundaries

The intended Bun workspace has these dependency directions:

```text
@deskcompat/schema <- @deskcompat/core <- @deskcompat/ubuntu-gnome <- deskcompat CLI
         ^
         +------------------------------------------------ deskcompat-admin
```

- `packages/schema`: runtime schemas, tagged unions, and shared wire types. It has no
  system I/O.
- `packages/core`: pure planning plus transaction, journal, ownership, locking, and
  recovery orchestration. Canonical hashing also lives here. It does not know GNOME
  keys or keyd syntax.
- `packages/ubuntu-gnome`: the v0.1 platform probe, product modules, and user-level
  resource drivers.
- `apps/cli`: command parsing and human/JSON presentation. Command handlers call the
  same core APIs in both modes.
- `apps/admin`: a separately packaged helper for a closed set of privileged input
  operations. It must not import the CLI or a generic command runner.

Do not create a package per module. Workspaces exist to enforce the privileged and
pure-domain boundaries, not to establish a plugin ecosystem.

## Profile, module, and driver separation

A profile contains portable user intent. It does not contain the detected host,
backend selection, usernames, home paths, device IDs, or commands.

Each module has one of three management states:

- `unmanaged`: claim no target resource and leave it untouched; general diagnostics
  may still report a relevant capability or conflict.
- `managed`: reconcile the resource to the declared value.
- `disabled`: restore the original baseline only when DeskCompat already owns the
  resource; otherwise do nothing.

Modules are pure resolvers:

```ts
interface ModuleDefinition<Config> {
  id: ModuleId;
  requiredCapabilities(config: Config): readonly CapabilityId[];
  resolve(config: Config, facts: HostFacts): readonly DesiredResource[];
}
```

Drivers own effects:

```ts
interface ResourceDriver<Operation> {
  inspect(target: unknown): Promise<ObservedState>;
  prepare(operation: Operation, context: TransactionContext): Promise<PreparedReceipt>;
  apply(operation: Operation, receipt: PreparedReceipt): Promise<ApplyReceipt>;
  verify(operation: Operation): Promise<VerificationResult>;
  revert(operation: Operation, receipt: ApplyReceipt): Promise<RevertResult>;
}
```

`prepare` may validate and durably store recovery material, but it must not mutate the
target. The current operation union is closed and limited to known GNOME settings.
Future v0.1 milestones may add project-owned user files and a semantic keyboard
profile without introducing shell commands or arbitrary destination paths.

## Planning

Planning performs these steps in order:

1. Parse and runtime-validate the versioned profile.
2. Inspect supported host facts and capabilities.
3. Resolve enabled modules into desired resources.
4. Reject missing capabilities, conflicts, and duplicate resource ownership.
5. Inspect the explicit current state of every target.
6. Compute typed operations and rollback-quality metadata.
7. Sort operations deterministically by kind and resource ID. Dependency edges are
   rejected until the executor implements and tests them.
8. Canonicalize behavior and observations into a stable `semanticDigest`, then derive
   `planId` from the complete expiring artifact.
9. Return the plan without writing application or desktop state. `apply --plan` later
   persists the exact reviewed artifact under the user state directory before mutation.

Creation timestamps and presentation strings do not participate in `semanticDigest`;
creation and expiry do participate in `planId`. Applying a plan reloads it, validates
both identities, then reinspects all preconditions. Any drift makes the plan stale;
DeskCompat does not silently recalculate an approved plan.

## Applying and recovering

DeskCompat uses a durable sequence of compensating operations, not a cross-system
transaction. Before each side effect it stores the prior state and fsyncs an intent
event. After the effect it inspects the resource and fsyncs the observed result.

On failure, completed operations are reverted in reverse order when their current
state still matches the value DeskCompat applied. A conflict or failed compensation is
reported as `recovery-required`; it is never described as a successful rollback.

The authoritative state is an append-only transaction journal. A managed-resource
index records original baselines and last applied digests, but it is rebuildable from
committed journal entries. See [transaction semantics](transaction-semantics.md).

## GNOME boundary

The GNOME driver uses an allowlist containing the schema, key, dconf path, value type,
and owner for every managed setting. It reads both:

- the effective value through `gsettings`; and
- the raw stored value through `dconf read`, so unset and explicitly-set-default are
  distinguishable.

Reverting an originally unset key uses `dconf reset`. A stored value is restored only
when the current digest still equals DeskCompat's last applied digest. v0.1 does not
replace shared arrays such as enabled extensions or application favourites.

## Privileged boundary

The general CLI always runs as the graphical user. Running it as root is unsupported,
because GNOME state belongs to the user's session.

The separately installed admin helper accepts runtime-validated, discriminated
requests for named input operations only. It cannot expose generic file writing,
service management, or command execution. It owns one namespaced configuration file
and a root-owned recovery journal. Existing third-party input configurations are not
overwritten.

Input activation first persists a recovery marker and arms a reverter independent of
the CLI and graphical session. An unconfirmed trial is restored on timeout or boot.
Details and limitations are in [the safety model](safety-model.md).

## Command execution

System programs are invoked with `Bun.spawn` using argument arrays, absolute executable
paths, a bounded output size, timeouts, and a sanitized environment. No driver uses a
shell. Diagnostics must not record environment contents or secrets.

## Persistence

User state is stored below `$XDG_STATE_HOME/deskcompat` (falling back to
`~/.local/state/deskcompat`):

```text
plans/<plan-id>.json
transactions/<transaction-id>/manifest.json
transactions/<transaction-id>/journal.ndjson
transactions/<transaction-id>/blobs/<sha256>
managed-state.json
```

Privileged recovery state lives under `/var/lib/deskcompat`. Files are written with a
temporary-file, fsync, rename, and parent-directory fsync sequence. State directories
do not follow symlinks and use restrictive permissions.

## Future boundaries

After v0.1, DeskCompat may add mouse devices, more Ubuntu releases, and a read-only MCP
adapter. A public declarative profile format can become stable at v1. Dynamic adapters
are considered only after multiple real implementations demonstrate a common API.
Privileged third-party plugins are not planned.
