import { describe, expect, it, vi } from "vitest";
import type { PdfRepairModule } from "./repair-pdf-module";
import { RepairSession } from "./repair-session";
import type { RepairVerifier, VerificationResult } from "./repair-verifier";

function createMockVerifier(result: VerificationResult): RepairVerifier {
  return {
    verify: vi.fn().mockReturnValue(result),
  } as unknown as RepairVerifier;
}

function createMockRepairModule(
  repairOutcome:
    | { ok: true; pdf: Uint8Array; report: string }
    | { ok: false; code: string; message: string },
): PdfRepairModule {
  return {
    repair: vi.fn().mockReturnValue(repairOutcome),
  } as unknown as PdfRepairModule;
}

describe("RepairSession", () => {
  it("rejects empty files as failed", async () => {
    const verifier = createMockVerifier({
      valid: false,
      reason: "empty",
      message: "empty",
    });
    const repairModule = createMockRepairModule({
      ok: false,
      code: "empty",
      message: "empty",
    });

    const session = new RepairSession(repairModule, verifier);
    const outcome = await session.repair(new Uint8Array(0));

    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.message).toContain("empty");
    }
  });

  it("handles documents recoverable via direct PDFium verification", async () => {
    const normalized = new Uint8Array([37, 80, 68, 70]);
    const verifier = createMockVerifier({
      valid: true,
      pageCount: 3,
      normalizedBytes: normalized,
    });
    const repairModule = createMockRepairModule({
      ok: false,
      code: "unused",
      message: "unused",
    });

    const session = new RepairSession(repairModule, verifier);
    const input = new Uint8Array([1, 2, 3]);
    const outcome = await session.repair(input);

    expect(outcome.kind).toBe("repaired");
    if (outcome.kind === "repaired") {
      expect(outcome.pageCount).toBe(3);
      expect(outcome.pdf).toEqual(normalized);
      expect(outcome.report.xrefReconstructed).toBe(true);
      expect(outcome.report.issues).toContain("Cross-reference table rebuilt and normalized");
    }
  });

  it("returns password-required when direct verification detects encryption", async () => {
    const verifier = createMockVerifier({
      valid: false,
      reason: "password-required",
      message: "Password required",
    });
    const repairModule = createMockRepairModule({
      ok: false,
      code: "unused",
      message: "unused",
    });

    const session = new RepairSession(repairModule, verifier);
    const outcome = await session.repair(new Uint8Array([1, 2, 3]));

    expect(outcome.kind).toBe("password-required");
  });

  it("invokes WASM carving when direct verification fails, and verifies recovered PDF", async () => {
    const carvedBytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
    const reportJson = JSON.stringify({
      headerRepaired: true,
      eofRepaired: true,
      xrefReconstructed: true,
      trailerReconstructed: true,
      objectsRecovered: 12,
      streamsRepaired: 0,
      pagesRecovered: 5,
      issues: ["Stripped 32 bytes of leading garbage", "Rebuilt xref table"],
    });

    const verifier: RepairVerifier = {
      verify: vi
        .fn()
        // First call (direct on corrupt input) fails
        .mockReturnValueOnce({
          valid: false,
          reason: "corrupt",
          message: "corrupt",
        })
        // Second call (on carved bytes) succeeds
        .mockReturnValueOnce({
          valid: true,
          pageCount: 5,
          normalizedBytes: carvedBytes,
        }),
    } as unknown as RepairVerifier;

    const repairModule = createMockRepairModule({
      ok: true,
      pdf: carvedBytes,
      report: reportJson,
    });

    const session = new RepairSession(repairModule, verifier);
    const outcome = await session.repair(new Uint8Array([99, 99]));

    expect(outcome.kind).toBe("repaired");
    if (outcome.kind === "repaired") {
      expect(outcome.pageCount).toBe(5);
      expect(outcome.report.issues).toContain("Rebuilt xref table");
      expect(outcome.report.objectsRecovered).toBe(12);
      expect(outcome.report.headerRepaired).toBe(true);
    }
  });

  it("returns password-required if carved PDF requires password", async () => {
    const carvedBytes = new Uint8Array([37, 80, 68, 70]);
    const reportJson = JSON.stringify({
      headerRepaired: false,
      eofRepaired: false,
      xrefReconstructed: true,
      trailerReconstructed: false,
      objectsRecovered: 4,
      streamsRepaired: 0,
      pagesRecovered: 1,
      issues: ["Rebuilt xref table"],
    });

    const verifier: RepairVerifier = {
      verify: vi
        .fn()
        .mockReturnValueOnce({
          valid: false,
          reason: "corrupt",
          message: "corrupt",
        })
        .mockReturnValueOnce({
          valid: false,
          reason: "password-required",
          message: "Password required",
        }),
    } as unknown as RepairVerifier;

    const repairModule = createMockRepairModule({
      ok: true,
      pdf: carvedBytes,
      report: reportJson,
    });

    const session = new RepairSession(repairModule, verifier);
    const outcome = await session.repair(new Uint8Array([99]));

    expect(outcome.kind).toBe("password-required");
  });

  it("returns failed if both direct and WASM recovery fail", async () => {
    const verifier = createMockVerifier({
      valid: false,
      reason: "corrupt",
      message: "corrupt",
    });
    const repairModule = createMockRepairModule({
      ok: false,
      code: "invalid-pdf",
      message: "No indirect objects could be recovered from the file.",
    });

    const session = new RepairSession(repairModule, verifier);
    const outcome = await session.repair(new Uint8Array([99, 99]));

    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") {
      expect(outcome.message).toContain("No indirect objects");
    }
  });
});
