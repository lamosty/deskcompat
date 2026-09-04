# Security policy

DeskCompat is intended to change desktop and, in future releases, input configuration.
A defect in those future paths could lock someone out of their keyboard or overwrite
valuable preferences. Treat safety defects as security defects even when they do not
cross a privilege boundary.

## Reporting a vulnerability

Please use a private
[GitHub security advisory](https://github.com/lamosty/deskcompat/security/advisories/new).
Do not include secrets, raw environment dumps, window titles, full dconf exports,
or personally identifying hardware data in a report.

Include only the minimum reproducible information:

- DeskCompat revision or release
- Ubuntu, GNOME, and session versions
- affected module and stable diagnostic codes
- redacted plan or journal excerpts
- expected and observed safety impact

We will acknowledge a report as soon as practical, investigate it privately, and
coordinate disclosure after a fix is available. There is no paid bug-bounty program.

## Supported versions

DeskCompat is currently pre-alpha and has no supported release. Security fixes are
made on `main`; do not use the project on a machine you cannot recover.

## Enforced in the current read-only build

- `doctor`, profile validation, and `plan` do not write DeskCompat or desktop state.
- Profiles are inert, strictly validated data and cannot contain executable hooks.
- Host tools use absolute executable paths and argument vectors without a shell.
- Subprocess output and runtime profile input are size bounded.
- Unsupported platforms produce blockers and no resource inspection plan.
- No runtime telemetry or network access exists.

## Required before mutation ships

- Host inspection, planning, and application refuse to run as root; a separate helper
  owns the narrowly privileged operations.
- Privileged helpers, when introduced, expose only fixed allowlisted operations.
- Plans are immutable and stale preconditions block application.
- Rollback is conditional and never overwrites externally changed state silently.
