# Transaction semantics

> [!IMPORTANT]
> This is the required design for a future mutating milestone. The current pre-alpha
> is read-only and implements no transaction, journal, apply, revert, or recovery path.

## Summary

DeskCompat will coordinate changes across APIs that do not share a transaction manager.
It therefore requires a durable journal and compensating operations. Individual file
writes may be atomic, but a multi-resource DeskCompat apply will not be atomic.

## Terms

- **Observed state:** the explicit current value and digest read from a resource.
- **Desired state:** the typed value emitted by a module.
- **Plan:** immutable ordered operations plus their observed preconditions.
- **Transaction:** one attempt to apply or revert a plan.
- **Before state:** the value immediately before a transaction operation.
- **Original baseline:** the value before DeskCompat first acquired a resource.
- **Applied digest:** the value DeskCompat last verified after applying.
- **Compensation:** a conditional operation intended to restore a before state.

Transaction revert and module disable differ. Reverting transaction B restores the
state before B, which may be the value applied by transaction A. Disabling a module
restores the original baseline recorded when DeskCompat first acquired the resource.

## Plan identity and validity

The planner canonicalizes semantic content and hashes it with SHA-256. The stable
`semanticDigest` covers:

- schema and tool protocol versions;
- support target and relevant host-facts digest;
- selected-profile intent digest and normalized module scope;
- every resolved resource outcome, including unchanged and skipped resources;
- sorted operations and expected-before digests;
- dependencies, risk, privilege, and rollback quality.

Timestamps and rendered explanations do not affect `semanticDigest`. A separate
`planId` covers the complete persisted artifact, including creation and expiry, so two
separately created plans cannot collide merely because their intended behavior matches.
Apply rejects a plan when:

- its runtime schema is invalid;
- its recomputed digest differs;
- it has expired;
- its target no longer matches the host;
- it contains blockers;
- any resource precondition has changed.

A stale plan must be regenerated and reviewed.

Portable plan JSON deliberately contains no username, home path, or stable machine
identifier. Before mutation exists, the private persisted-plan manifest must bind the
artifact to the invoking effective UID and graphical-session context. Apply must check
that binding locally without exporting it or incorporating it into shared profiles.

## Operation ordering

The planner first topologically sorts explicit dependencies. Ties are resolved using a
fixed operation-kind rank followed by lexical resource ID. The order must not depend on
filesystem enumeration, locale, object insertion order, or timing.

Preparation runs for every operation before the first mutation when feasible. A prepare
step validates capability and stores recovery material, but cannot change the target.
If preparation fails, the transaction stops without applying later operations.

## Transaction states

```text
preparing -> applying -> trial -> committed
     |          |          |
     +----------+----------+-> reverting -> reverted
                                  |
                                  +-> conflicted
                                  +-> recovery-required

preparing/applying/trial may also end as failed when no unapplied effect remains.
```

- `preparing`: validating operations and persisting before states.
- `applying`: executing ordered side effects and verifying each result.
- `trial`: an input-critical change is active but awaiting confirmation.
- `committed`: every operation was verified and any required trial was confirmed.
- `reverting`: compensations are executing in reverse apply order.
- `reverted`: every required compensation was verified or already satisfied.
- `conflicted`: current state matches neither the recorded before nor applied state.
- `recovery-required`: state could not be inspected, verified, or compensated safely.
- `failed`: the attempt stopped and no remaining applied effect is known.

`committed`, `reverted`, `conflicted`, `recovery-required`, and `failed` are terminal for
one transaction record. Further recovery creates a linked recovery transaction.

## Durable journal protocol

Each transaction has an append-only NDJSON journal and content-addressed blobs. Events
have a monotonically increasing sequence number and include the transaction, operation,
event kind, relevant digests, and timestamp. Error fields are redacted.

For each operation:

1. Inspect and verify the plan precondition.
2. Persist the exact before state or a reference to its fsynced blob.
3. Append and fsync `operation_intent`.
4. Perform the side effect.
5. Inspect the resource again.
6. Append and fsync `operation_applied`, `operation_noop`, or `operation_failed`.

The intent must reach durable storage before step 4. After every journal append, the
manifest/index update may lag; the journal is authoritative and the index is rebuildable.

## Crash recovery

For an operation with an intent but no terminal event, recovery inspects current state:

| Observed state | Recovery interpretation |
|---|---|
| Matches desired digest | Side effect completed; record it as applied |
| Matches before digest | Side effect did not persist or was already restored |
| Matches neither | Conflict; do not overwrite |
| Cannot be inspected | Recovery required |

Recovery then either resumes the declared workflow or compensates verified applied
operations in reverse order. Repeated recovery must be idempotent.

Input-critical trials also have a root-owned marker and independent system recovery.
The user journal cannot be the only evidence for a privileged input change.

## Compensation rules

Before compensation, the driver compares current state with its receipts:

| Current state | Result |
|---|---|
| Equals applied state | Restore before state, then verify |
| Equals before state | Record idempotent compensation success |
| Anything else | Record conflict and stop for that resource |

Compensation never blindly restores a snapshot over an external change. Successful
compensation of earlier operations does not hide a later conflict.

Rollback quality is reported per operation:

- `exact-if-unchanged`: complete prior representation is available and current state
  still matches the applied digest.
- `conditional`: restoration depends on an external API or session state.
- `best-effort`: effects such as service activation cannot be guaranteed to match all
  prior runtime state.

Operations without an acceptable recovery strategy are not permitted in v0.1 plans.

## GNOME values

For a GNOME setting, the receipt records:

- schema and key from the built-in allowlist;
- exact dconf path;
- whether the raw value was absent;
- raw before value when present;
- effective typed before value;
- desired and verified applied digests.

An absent raw value is restored with `dconf reset`; it is not rewritten as the current
schema default. Shared arrays are excluded from v0.1 because whole-value restoration
could erase independent changes.

## Ownership index

On the first successful acquisition of a resource, DeskCompat stores its original
baseline. Later transactions update only the desired/applied digest and last transaction
reference. The original baseline remains unchanged until ownership is successfully
released.

The managed-state index is updated atomically only after the corresponding journal
events are durable. If they disagree, replaying committed journal records repairs the
index.

## Concurrency

Only one mutating user transaction may run at once. The Linux lock records PID, boot ID,
and process start time so an abandoned lock can be distinguished from PID reuse.

Locking does not prevent GNOME or another tool from changing a target. Resource digests
and compare-before-write checks remain mandatory immediately before each mutation.

## Privileged subtransactions

The CLI and admin helper keep separate journals linked by one transaction ID. The helper
revalidates its own expected state and returns a typed receipt. The CLI must not mark the
parent operation applied until that receipt and a fresh inspection agree.

Failure to contact the helper after requesting activation is ambiguous and enters
recovery rather than assuming success. Pending input trials are resolved by the
root-owned timeout/boot recovery path even when the user transaction process is gone.
