/**
 * Client adapter bridging the main UI thread to the PDF repair Web Worker.
 *
 * Implements SOLID Principles:
 * - Single Responsibility: Encapsulates message sending and buffer transfers for repair operations.
 * - Dependency Inversion: Injects abstract `RepairRequestSender` so tests can pass fakes.
 * - Interface Segregation: Exposes only needed client methods (`repair`, `terminate`).
 */

import { WorkerClient, type RequestOptions } from "@/lib/worker-client";
import type { RepairRequest, RepairWorkerResult } from "./messages";

/** Abstract client contract consumed by React hooks and components. */
export interface RepairClient {
  /**
   * Dispatches a PDF repair request to the background worker.
   *
   * @param data Raw buffer of the damaged PDF (transferred).
   * @param filename Name of the file being repaired.
   * @param password Optional document open password.
   * @param onProgress Optional callback receiving execution progress.
   * @returns The repair worker result.
   */
  repair(
    data: ArrayBuffer,
    filename: string,
    password?: string,
    onProgress?: (progress: number, stage?: string) => void,
  ): Promise<RepairWorkerResult>;

  /** Terminates the underlying worker and rejects active requests. */
  terminate(): void;
}

/** Abstraction over WorkerClient request dispatching for unit testing. */
export interface RepairRequestSender {
  request(
    payload: RepairRequest,
    options?: RequestOptions,
  ): Promise<RepairWorkerResult>;
  terminate(): void;
}

/**
 * Concrete {@link RepairClient} dispatching requests to a Web Worker.
 */
export class WorkerRepairClient implements RepairClient {
  /**
   * @param sender The worker communication sender.
   */
  constructor(private readonly sender: RepairRequestSender) {}

  /**
   * Submits a repair job to the worker, transferring the input buffer.
   *
   * @inheritdoc
   */
  repair(
    data: ArrayBuffer,
    filename: string,
    password?: string,
    onProgress?: (progress: number, stage?: string) => void,
  ): Promise<RepairWorkerResult> {
    return this.sender.request(
      { op: "repair", data, filename, password },
      {
        transfer: [data],
        onProgress: onProgress
          ? (progress, stage) => onProgress(progress, stage)
          : undefined,
      },
    );
  }

  /**
   * Terminates the worker thread immediately.
   *
   * @inheritdoc
   */
  terminate(): void {
    this.sender.terminate();
  }
}

/**
 * Factory creating an instance of {@link RepairClient} backed by a fresh Web Worker.
 *
 * @returns A lazily instantiated {@link RepairClient}.
 */
export function createWorkerRepairClient(): RepairClient {
  return new WorkerRepairClient(
    new WorkerClient<RepairRequest, RepairWorkerResult>(
      () =>
        new Worker(new URL("./worker/pdf-repair.worker.ts", import.meta.url), {
          type: "module",
        }),
    ),
  );
}
