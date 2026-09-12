import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { dirname } from "node:path";
import {
  TRANSACTION_API_VERSION,
  type TransactionJournalEvent,
  TransactionJournalEventSchema,
} from "@deskcompat/schema";
import { canonicalJson } from "../canonical-json.ts";
import { TransactionError } from "./errors.ts";
import {
  ensurePrivateDirectory,
  fsyncDirectory,
  pathExists,
  readPrivateFile,
  refuseSymlink,
} from "./filesystem.ts";
import type { TransactionStore } from "./store.ts";

type JournalEventInput = TransactionJournalEvent extends infer Event
  ? Event extends TransactionJournalEvent
    ? Omit<Event, "apiVersion" | "sequence" | "timestamp" | "transactionId">
    : never
  : never;

export class TransactionJournal {
  private sequence = 0;

  constructor(
    private readonly store: TransactionStore,
    readonly transactionId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async readPrefix(): Promise<{
    events: TransactionJournalEvent[];
    durableBytes: number;
    hasTornTail: boolean;
  }> {
    const path = this.store.journalPath(this.transactionId);
    if (!(await pathExists(path))) return { events: [], durableBytes: 0, hasTornTail: false };
    const raw = await readPrivateFile(path);
    const hasTornTail = raw.length > 0 && !raw.endsWith("\n");
    const durable = hasTornTail ? raw.slice(0, raw.lastIndexOf("\n") + 1) : raw;
    const events: TransactionJournalEvent[] = [];
    for (const line of durable.split("\n")) {
      if (line.length === 0) continue;
      let event: TransactionJournalEvent;
      try {
        event = TransactionJournalEventSchema.parse(JSON.parse(line));
      } catch {
        throw new TransactionError("JOURNAL_CORRUPT", "Journal contains an invalid record");
      }
      if (event.transactionId !== this.transactionId || event.sequence !== events.length + 1) {
        throw new TransactionError("JOURNAL_CORRUPT", "Journal sequence or identity is invalid");
      }
      events.push(event);
    }
    this.sequence = events.length;
    return { events, durableBytes: Buffer.byteLength(durable), hasTornTail };
  }

  /**
   * Return every complete, durable record. A non-newline-terminated final fragment
   * is a recoverable torn append; corruption in any complete record still fails.
   */
  async read(): Promise<TransactionJournalEvent[]> {
    return (await this.readPrefix()).events;
  }

  /** @constraint Each event is one append write followed by fsync before returning. */
  async append(input: JournalEventInput): Promise<TransactionJournalEvent> {
    const prefix = await this.readPrefix();
    const event = TransactionJournalEventSchema.parse({
      ...input,
      apiVersion: TRANSACTION_API_VERSION,
      transactionId: this.transactionId,
      sequence: this.sequence + 1,
      timestamp: this.now().toISOString(),
    });
    const path = this.store.journalPath(this.transactionId);
    const parent = dirname(path);
    await ensurePrivateDirectory(parent);
    await refuseSymlink(path);
    const existed = await pathExists(path);
    if (existed && prefix.hasTornTail) {
      const repair = await open(path, constants.O_WRONLY | constants.O_NOFOLLOW);
      try {
        await repair.truncate(prefix.durableBytes);
        await repair.sync();
      } finally {
        await repair.close();
      }
    }
    const handle = await open(
      path,
      constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(`${canonicalJson(event)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (!existed) await fsyncDirectory(parent);
    this.sequence = event.sequence;
    return event;
  }
}
