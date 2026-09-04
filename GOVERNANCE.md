# Governance

DeskCompat currently uses a maintainer-led governance model. The current maintainer is
[@lamosty](https://github.com/lamosty).

The maintainers are responsible for releases, the support matrix, security response,
and changes to privileged or recovery-sensitive interfaces. Ordinary decisions are
made in pull requests. Cross-cutting decisions should be recorded in an architecture
decision record under `docs/adr/`.

## Decision principles

1. Safety and reversibility outrank breadth and convenience.
2. Existing user configuration is preserved unless a plan explicitly owns it.
3. New platforms require a maintainer and repeatable test environment.
4. New abstractions follow demonstrated reuse rather than speculative generality.
5. Recovery functionality will remain part of the open-source core if and when it is
   implemented.

Governance can become multi-maintainer when sustained contributors emerge. Until
then, repository activity or popularity does not imply a compatibility promise.
