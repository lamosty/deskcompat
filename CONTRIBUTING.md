# Contributing to DeskCompat

Thank you for helping make Linux desktop adaptation safer.

DeskCompat is pre-alpha. Discuss substantial features in an issue before investing
in an implementation. Security reports belong in a private advisory, not a public
issue; see [SECURITY.md](SECURITY.md).

## Development setup

Requirements:

- Linux for host-integration work
- [Bun](https://bun.sh/) at the version in `.bun-version`

```sh
git clone https://github.com/lamosty/deskcompat.git
cd deskcompat
bun install --frozen-lockfile
bun run ci
```

## Change requirements

1. Keep each change focused and add tests.
2. Preserve the safety contract in [AGENTS.md](AGENTS.md).
3. Do not add telemetry, network access, arbitrary shell hooks, or new privileged
   operations without an accepted design discussion and threat-model update.
4. Update the support matrix when platform behavior changes.
5. Use conventional commit messages such as `feat(core): add deterministic plans`.

Pull requests must explain the user-visible behavior, risks, rollback behavior,
and verification performed. A maintainer may require physical testing for input
changes even when automated tests pass.

## Developer Certificate of Origin

Contributions must include a `Signed-off-by` line certifying the
[Developer Certificate of Origin 1.1](https://developercertificate.org/):

```sh
git commit -s
```

This avoids requiring contributors to sign a separate contributor agreement.
Maintainers check sign-offs during review until an automated DCO check is installed.
