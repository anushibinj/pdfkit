import type { PageInfo } from "@/tools/edit/core/model";
import { formatBytes } from "@/lib/format";
import type { OpenResult } from "./messages";

/** A file the engine opened. */
export interface OpenedFile {
  id: string;
  name: string;
  pages: PageInfo[];
  /** It needed a password. */
  passwordProtected: boolean;
}

/** What the queue needs from the outside world (all injected for tests). */
export interface OpenQueueDeps {
  /** Read a file's bytes. */
  read(file: File): Promise<ArrayBuffer>;
  /** Open bytes in the engine under `id`. */
  open(id: string, data: ArrayBuffer, password: string): Promise<OpenResult>;
  /**
   * Ask the user for a file's password.
   *
   * @returns The password, or `null` when the user skips the file.
   */
  askPassword(fileName: string, wrong: boolean): Promise<string | null>;
  /**
   * A file opened. Return `false` to refuse it (the board is full, say);
   * the queue then closes it again.
   */
  onOpened(file: OpenedFile): boolean;
  /** Close a refused file in the engine. */
  close(id: string): void;
  /** A file could not be opened (or was refused before opening). */
  onFailed(fileName: string, message: string): void;
  /** The file being opened changed (`null` when the queue is idle). */
  onBusy(fileName: string | null): void;
  /** A new, unique file id. */
  newId(): string;
}

/** Size limits, in bytes. */
export interface OpenQueueLimits {
  /** Largest single file. */
  maxFileBytes: number;
  /** Largest total of all files open at once. */
  maxTotalBytes: number;
}

/**
 * Opens the files the user adds, one at a time, in the order given.
 *
 * Why one at a time: a password prompt is a modal dialog, and the user can
 * only answer one. While a file waits for its password, the files after it
 * wait too, so they are added to the board in the order they were picked.
 *
 * The flow for one file:
 * 1. Refuse it up front if it is too large on its own, or would take the
 *    total of open files over the limit (both checked before reading it).
 * 2. Read it and open it without a password.
 * 3. If the engine says a password is needed (or the one given is wrong),
 *    ask the user, and try again with the answer. Skipping moves on to the
 *    next file.
 * 4. Hand the opened file to `onOpened`, which may still refuse it.
 *
 * `cancel()` (the user cleared the board) drops the waiting files and
 * makes every step still in flight stop at its next check, using a
 * generation number: each step remembers the generation it started in and
 * gives up if it has changed. A pending password prompt is not answered by
 * the queue; the caller closes it, which answers `null`.
 */
export class OpenQueue {
  private readonly waiting: File[] = [];
  private running = false;
  private generation = 0;
  private totalBytes = 0;

  /**
   * @param deps The outside world.
   * @param limits Size limits.
   */
  constructor(
    private readonly deps: OpenQueueDeps,
    private readonly limits: OpenQueueLimits,
  ) {}

  /**
   * Add files and start opening them if the queue is idle.
   *
   * @param files The files, in the order to open them.
   * @returns Resolves when the queue has nothing left to open (immediately
   *   when it was already running: the running loop picks the files up).
   */
  async add(files: readonly File[]): Promise<void> {
    this.waiting.push(...files);
    if (this.running) return;
    this.running = true;
    const generation = this.generation;
    try {
      while (this.waiting.length > 0 && generation === this.generation) {
        await this.openOne(this.waiting.shift()!, generation);
      }
    } finally {
      // Only the loop of the current generation reports idle; a cancelled
      // loop must not hide the busy state of a newer one.
      if (generation === this.generation) {
        this.running = false;
        this.deps.onBusy(null);
      }
    }
  }

  /** Forget the waiting files and abandon the one being opened. */
  cancel(): void {
    this.generation++;
    this.waiting.length = 0;
    this.running = false;
    this.totalBytes = 0;
    this.deps.onBusy(null);
  }

  /** @returns Whether a file is being opened or waiting. */
  isBusy(): boolean {
    return this.running;
  }

  /**
   * Open one file (steps 1 to 4 above).
   *
   * @param file The file.
   * @param generation The generation the loop started in.
   */
  private async openOne(file: File, generation: number): Promise<void> {
    const { deps, limits } = this;
    if (file.size > limits.maxFileBytes) {
      deps.onFailed(
        file.name,
        `It is over ${formatBytes(limits.maxFileBytes)}, too large to organize in the browser.`,
      );
      return;
    }
    if (this.totalBytes + file.size > limits.maxTotalBytes) {
      deps.onFailed(
        file.name,
        `Together with the files already open it would be over ${formatBytes(limits.maxTotalBytes)}.`,
      );
      return;
    }
    deps.onBusy(file.name);
    let data: ArrayBuffer;
    try {
      data = await deps.read(file);
    } catch {
      if (generation === this.generation)
        deps.onFailed(file.name, "The file could not be read.");
      return;
    }
    const id = deps.newId();
    let password = "";
    for (;;) {
      if (generation !== this.generation) return;
      const result = await deps.open(id, data, password);
      if (generation !== this.generation) return;
      if (result.status === "opened") {
        const accepted = deps.onOpened({
          id,
          name: file.name,
          pages: result.pages,
          passwordProtected: password !== "",
        });
        if (accepted) this.totalBytes += file.size;
        else deps.close(id);
        return;
      }
      if (result.status === "error") {
        deps.onFailed(file.name, result.message);
        return;
      }
      const answer = await deps.askPassword(
        file.name,
        result.status === "wrong-password",
      );
      if (answer === null) return;
      password = answer;
    }
  }
}
