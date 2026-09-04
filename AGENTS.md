# Contributor and agent instructions

These rules apply to the entire repository.

## Safety contract

- Treat observed host state as untrusted and potentially sensitive.
- Never collect or persist credentials, environment dumps, hostnames, usernames,
  window titles, hardware serials, recent files, or arbitrary command contents.
- Never add arbitrary shell execution, arbitrary privileged file writes, or generic
  service-management operations.
- Planning must remain read-only. Mutations require a persisted, validated plan.
- Revert only a value that still matches the value DeskCompat applied. Surface
  external changes as conflicts instead of overwriting them.
- Never describe multi-resource changes as atomic. They use journaled compensating
  operations and can require recovery.
- Input changes require an independent timed rollback before they may ship.

## Engineering workflow

- Use Bun and TypeScript. Keep TypeScript strict and validate all persisted or
  externally supplied data at runtime.
- Use direct argument-vector subprocesses; never invoke a shell to run host tools.
- Add stable diagnostic codes and redact sensitive values at the boundary.
- Add tests for every behavior change, including failure and rollback paths.
- Keep platform assumptions behind the Ubuntu GNOME adapter.
- Document security-sensitive decisions immediately above the relevant code.

Run before proposing a change:

```sh
bun run ci
```
