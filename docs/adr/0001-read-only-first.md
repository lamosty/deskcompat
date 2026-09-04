# ADR 0001: Build the read-only planner before mutation

- **Status:** Accepted
- **Date:** 2026-09-04
- **Decision owners:** DeskCompat maintainers

## Context

DeskCompat will eventually change GNOME and input configuration. These resources do not
share a transaction mechanism, and input mistakes can lock a user out of normal desktop
control. The project is new, so its profile schema, resource identity, ownership rules,
and supported-platform detection have not yet been proven.

Starting with an installer or migration script would couple desired behaviour to side
effects before the project can show users exactly what it understands. Retrofitting
preconditions and recovery after mutating code exists would preserve unsafe assumptions.

## Decision

The first executable milestone is read-only. It will implement:

- runtime-validated versioned profiles;
- Ubuntu 24.04/GNOME 46/Wayland inspection;
- capability, prerequisite, and conflict detection;
- pure module resolution;
- typed operations with observed preconditions;
- deterministic ordering and canonical plan digests;
- human-readable and versioned JSON plan output.

It will not implement:

- `apply`, `revert`, or service activation;
- package installation;
- root or Polkit integration;
- generic command, file, or plugin execution;
- automatic adoption of unknown existing configuration.

The current read-only planner writes neither DeskCompat state nor target-system
resources. Immutable plan persistence begins with the guarded-application milestone,
where it will be disclosed as project-owned local state rather than called zero-write.

## Consequences

### Positive

- Profiles and operation schemas can be reviewed before becoming a write contract.
- Unsupported systems fail closed.
- Golden fixtures make plan determinism testable.
- Current personal configuration can be classified without claiming ownership.
- The privileged helper can later consume a small, evidence-based protocol.

### Negative

- The first milestone does not deliver automated setup.
- Some backend choices remain unresolved until inspection reveals real conflicts and
  prerequisites.
- Early users must treat output as an audit rather than a finished product.

These costs are accepted because safe mutation depends on a correct read model.

## Exit criteria

Mutation work may begin only when:

1. Repeated planning against unchanged fixtures produces identical semantic content and
   digests.
2. All operation kinds are closed, runtime-validated tagged unions.
3. Every target resource has a stable identity, owner, risk class, and rollback-quality
   declaration.
4. Unsupported hosts, missing prerequisites, and conflicting ownership produce blockers.
5. The planner distinguishes explicit dconf state from inherited defaults.
6. Tests prove profiles cannot introduce arbitrary paths or executable commands.

The next milestone may add compensating user-level GNOME operations. This decision does
not imply that a later multi-resource apply is atomic.

## Alternatives considered

### Start with a shell installer

Rejected because shell scripts encourage implicit state, broad privilege, weak runtime
schemas, and incomplete recovery records.

### Build apply and rollback together with planning

Rejected because write-side urgency would make the unproven read model and resource
ownership rules difficult to change safely.

### Depend on filesystem or VM snapshots

Rejected as the primary model. Snapshots are not universally available, do not express
per-resource ownership, and do not protect concurrent user changes. They may be an
optional external recovery layer in the future.
