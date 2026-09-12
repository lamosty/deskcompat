import {
  type GSettingsResourceId,
  type GSettingsSnapshot,
  GSettingsSnapshotSchema,
} from "@deskcompat/schema";
import { sha256 } from "../canonical-json.ts";
import { TransactionError } from "./errors.ts";

export type SnapshotState = GSettingsSnapshot["state"];

export function gsettingsSnapshotDigest(
  resourceId: GSettingsResourceId,
  state: SnapshotState,
): string {
  return sha256({
    domain: "deskcompat.gsettings-observation.v1",
    resourceId,
    ...state,
  });
}

/**
 * @constraint Drivers are untrusted at this boundary. A syntactically valid snapshot
 * is insufficient: its digest must bind the closed resource ID and the complete raw
 * and effective observation used for recovery.
 */
export function validateSnapshot(candidate: unknown): GSettingsSnapshot {
  const snapshot = GSettingsSnapshotSchema.parse(candidate);
  if (snapshot.digest !== gsettingsSnapshotDigest(snapshot.resourceId, snapshot.state)) {
    throw new TransactionError(
      "INTEGRITY_FAILURE",
      "The resource driver returned a snapshot with an invalid digest",
      snapshot.resourceId,
    );
  }
  return snapshot;
}
