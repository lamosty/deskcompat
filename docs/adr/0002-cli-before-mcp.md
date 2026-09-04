# ADR 0002: Stabilize the CLI contract before adding MCP

- **Status:** Accepted
- **Date:** 2026-09-04
- **Decision owners:** DeskCompat maintainers

## Context

DeskCompat should be straightforward for both humans and software agents to operate.
MCP could improve tool discovery, but it would also create another public interface
and, once mutation exists, another security-sensitive authorization surface. The core
profile, diagnostic, plan, approval, and recovery semantics are still pre-alpha.

## Decision

The versioned CLI and its JSON envelope are the canonical automation contract. Human
and JSON rendering call the same command handlers. JSON mode writes one document to
standard output, writes no presentation noise there, and uses stable diagnostic codes.

DeskCompat will not add MCP during the read-only foundation merely because an MCP
server is possible. A future MCP implementation must be a thin local adapter over the
same core operations and immutable plan flow. It may not add arbitrary shell access,
filesystem access, approval flags, or an independent privileged path.

Write-capable MCP is considered only when at least two real clients cannot use the JSON
CLI effectively and the approval model is already stable. Read-only MCP may arrive
earlier if shell-less clients demonstrate a concrete need.

## Consequences

- Agents can use DeskCompat immediately through deterministic process execution.
- The project maintains one behavior and security contract while semantics evolve.
- MCP discovery and typed tools are deferred rather than rejected permanently.
- CLI schemas, exit codes, redaction, and non-interactive behavior receive the rigor
  that both scripts and a future MCP adapter require.
