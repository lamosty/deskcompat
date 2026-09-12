# DeskCompat safety model

## Status and scope

This document defines required safety properties for DeskCompat v0.1. The scalar GNOME
transaction slice implements the user-level parts of this contract, but clean-VM,
interruption, upgrade, and daily-driver release validation is still outstanding.
Privileged input safety remains design-only.

DeskCompat is intended to change desktop and input configuration after these gates are
implemented. It can reduce risk and provide bounded recovery, but it cannot make
unrelated system APIs transactional or guarantee that a machine will never break.

## Trust boundaries

DeskCompat considers these boundaries separately:

1. **Profile data:** untrusted input, including profiles downloaded from GitHub.
2. **User process:** allowed to inspect and change the invoking user's supported
   desktop state.
3. **Admin helper:** allowed to perform a closed set of root-owned input operations
   after system authorization.
4. **External tools:** `dconf`, `gsettings`, keyd, GNOME, systemd, and Polkit may fail or
   change state independently.
5. **AI client:** a convenience client, not a trusted authorization boundary.

An AI process with the same Unix permissions as the user can invoke the same commands
or bypass DeskCompat entirely. Plan review prevents accidents and stale execution; it
does not prove that a human, rather than an AI, initiated a user-level operation.

## Safety invariants

Every mutating implementation must preserve these invariants:

- No change occurs without a validated, persisted plan.
- Applying a plan never silently recalculates it.
- Every operation has an observed precondition and an owning module.
- Recovery material is durably stored before its corresponding side effect.
- DeskCompat reinspects immediately before mutation and refuses any detected change
  after planning or application.
- One resource has at most one DeskCompat module owner.
- Profiles cannot contain code, commands, arbitrary paths, or executable hooks.
- The user CLI never runs as root.
- The admin helper exposes no generic file, service, or shell primitive.
- Input trials have a recovery mechanism independent of the initiating process.
- A failed compensation is reported as recovery required, not as rollback success.

## Risk classes

| Class | Examples | Required handling |
|---|---|---|
| Read-only | Doctor, inspection, planning | No authorization or mutation |
| Low | Project-owned user file | Plan, precondition, journal, verification |
| Desktop session | GNOME setting | Explicit plan, typed value, conditional revert |
| Input critical | keyd mapping or input service activation | System authorization, timed trial, independent recovery |

Package installation, removal, and distribution upgrades are outside the v0.1 apply
transaction. They have maintainer-script and dependency side effects that DeskCompat
cannot restore exactly.

## Profile and plan safety

Runtime schemas reject unknown operation kinds and unsupported values. A profile may
select only built-in product capabilities. Backend rendering converts semantic data
into a restricted target grammar; raw keyd content is not accepted by the admin helper.

Plans contain:

- the supported platform target;
- profile, facts, and operation digests;
- exact resource preconditions;
- privilege and risk classifications;
- rollback quality and user-visible impact;
- blockers and warnings.

Each plan has two identities. `semanticDigest` covers canonical behavior, scope, facts,
resource outcomes, preconditions, and structured diagnostics while excluding prose and
time. `planId` covers the complete artifact, including creation and expiry. Apply will
verify both and abort if either is invalid, the plan expired, or a precondition changed.
A digest prevents accidental time-of-check/time-of-use changes; it is not authorization.

## Desktop state safety

DeskCompat manages only allowlisted GNOME keys. It records whether a dconf value was
unset rather than assuming the schema default is equivalent. It does not replace
shared setting arrays wholesale in v0.1.

On revert, DeskCompat compares the current value with the value it applied:

- equal: restore the recorded prior value;
- already at the prior value: report an idempotent success;
- anything else: stop with a conflict.

This conditional behaviour avoids erasing changes made by the user, GNOME, another
agent, or another configuration tool after DeskCompat ran.

GSettings/dconf does not expose a true compare-and-swap write. Reinspection narrows the
race window but cannot prove whether another process wrote the identical desired value
between the final comparison and the write. DeskCompat does not claim stronger atomic
ownership than the underlying API can provide.

## Privilege safety

The admin helper is installed as a root-owned executable and invoked through the
system authorization mechanism. It must:

- accept only a small discriminated JSON protocol;
- cap request and response sizes;
- validate all data at runtime;
- use fixed, namespaced destinations;
- reject symlinks, path traversal, and unexpected ownership or permissions;
- invoke fixed absolute binaries without a shell;
- use a minimal sanitized environment;
- maintain its own root-owned journal;
- verify expected state again immediately before mutation.

The helper must not accept arbitrary paths, shell strings, environment overrides,
systemd unit names, or service commands. Static units and policy files belong in the
signed/reviewed package.

## Input trial safety

A syntactically valid keyboard mapping can still make input unusable. Before activation
the helper must:

1. Store the previous owned configuration and its digest.
2. Persist an unconfirmed trial marker.
3. Arm a system-level timeout reverter.
4. Validate and atomically install the candidate.
5. activate and health-check the backend.
6. restore immediately on activation failure.

Until confirmed, a boot-time recovery unit restores the previous state before the
experimental mapping is reused. Confirmation indicates that the user tested the new
input; it is a lockout guard, not a cryptographic human-presence assertion.

DeskCompat must document a recovery-console command independent of GNOME. No input
module is releasable until timeout, process-crash, and reboot recovery have been tested
in a VM and on physical hardware.

## Filesystem and process safety

- User state directories use mode `0700`; state files use `0600` unless explicitly
  documented otherwise.
- Writes use a same-directory temporary file, file fsync, atomic rename, and parent
  directory fsync.
- Rollback blobs are content-addressed and verified before use.
- Cross-process locking uses an atomic Linux primitive and detects stale owners using
  PID, boot ID, and process start time.
- Output collection is bounded to prevent memory exhaustion.
- Paths and subprocess arguments never flow through a shell.
- Logs and JSON output redact environment contents, usernames where unnecessary,
  device serials, and recovery blob contents.

## Failure and recovery policy

DeskCompat uses sequential operations and compensating actions. It never describes the
whole apply as atomic. A failure can leave a resource requiring manual recovery when an
external component fails or state changes concurrently.

The transaction engine must distinguish:

- `failed`: no remaining applied change is known;
- `conflicted`: observed state matches neither the recorded before nor applied value;
- `recovery-required`: an applied change could not be verified or compensated.

Recovery favors preserving external changes over forcing the historical snapshot.
`--force` conflict resolution is intentionally absent from v0.1.

## Supply chain and privacy

- Builds pin Bun and package dependencies and publish checksums.
- Install scripts in third-party JavaScript dependencies should be disallowed or
  explicitly audited.
- Downloads are never executed directly from a pipe.
- Profiles are data-only and safe to inspect offline.
- There is no telemetry in v0.1.
- A future diagnostic bundle must be opt-in, redacted, and reviewable before sharing.

## Release blockers

The following block a mutating release:

- an unrecovered input lockout;
- a path traversal, symlink, or arbitrary-command path through the admin helper;
- silent overwriting of externally changed state;
- a failure path reported as reverted without verification;
- inability to recover an interrupted journal deterministically;
- support claims not backed by the platform test matrix.
