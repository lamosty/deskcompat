import type { CliResult, HostFacts } from "@deskcompat/schema";
import { evaluateSupport, inspectLiveEnvironment } from "@deskcompat/ubuntu-gnome";
import { result } from "../output/render.ts";

export async function doctor(): Promise<CliResult<HostFacts>> {
  const { facts } = await inspectLiveEnvironment();
  return result("doctor", facts, [...evaluateSupport(facts), ...facts.conflicts]);
}
