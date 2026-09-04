export class CliEnvironmentError extends Error {
  constructor(
    readonly code: "ROOT_EXECUTION_UNSUPPORTED",
    message: string,
  ) {
    super(message);
    this.name = "CliEnvironmentError";
  }
}

/**
 * @constraint GNOME settings belong to the graphical user session. Running the
 * general CLI as root would inspect or later mutate the wrong home and dconf state.
 */
export function assertUnprivileged(effectiveUserId = process.geteuid?.()): void {
  if (effectiveUserId === 0) {
    throw new CliEnvironmentError(
      "ROOT_EXECUTION_UNSUPPORTED",
      "Run DeskCompat as the graphical user, not through sudo or a root shell.",
    );
  }
}
