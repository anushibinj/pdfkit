/// <reference lib="webworker" />
import { exposeWorker } from "@/lib/worker-protocol";
import type { WorkerRequestPayload, WorkerResultPayload } from "../messages";
import { stampVerified } from "../stamp";
import { verifyPdf } from "../verify-core";

exposeWorker<WorkerRequestPayload, WorkerResultPayload>(
  self as unknown as DedicatedWorkerGlobalScope,
  async (req, ctx) => {
    try {
      if (req.op === "stamp") {
        const data = await stampVerified(req.data, {
          signatureCount: req.signatureCount,
          verifiedAt: req.verifiedAt,
        });
        return { result: { status: "stamped", data }, transfer: [data] };
      }
      ctx.progress(0.2);
      const signatures = await verifyPdf(new Uint8Array(req.data));
      if (signatures.length === 0) {
        return { result: { status: "no-signatures" } };
      }
      return {
        result: {
          status: "checked",
          signatures,
          allValid: signatures.every((s) => s.status === "valid"),
          data: req.data,
        },
        transfer: [req.data],
      };
    } catch (err) {
      return {
        result: {
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  },
);
