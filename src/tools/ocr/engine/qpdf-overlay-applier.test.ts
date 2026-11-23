import { describe, expect, it } from "vitest";
import { FakeQpdfRunner } from "@/lib/qpdf/test-utils/fake-qpdf";
import { QpdfOverlayApplier } from "./qpdf-overlay-applier";

describe("QpdfOverlayApplier", () => {
  it("probes unencrypted, password-required, and unreadable PDFs", () => {
    const unencrypted = new FakeQpdfRunner((args) => {
      if (args.includes("--requires-password")) {
        return { code: 2, stderr: "" }; // EXIT_NOT_ENCRYPTED
      }
      return { code: 0, stderr: "", stdout: "" };
    });
    const applier1 = new QpdfOverlayApplier(unencrypted);
    expect(applier1.probePdf(new Uint8Array([1]), "")).toEqual({
      status: "ready",
    });

    const encrypted = new FakeQpdfRunner((args) => {
      if (args.includes("--requires-password")) {
        return {
          code: 0,
          stderr: "",
          stdout: "",
        };
      }
      if (args.includes("--password=secret")) {
        return { code: 0, stderr: "", stdout: "1\n" };
      }
      return { code: 2, stderr: "invalid password", stdout: "" };
    });
    const applier2 = new QpdfOverlayApplier(encrypted);
    expect(applier2.probePdf(new Uint8Array([1]), "")).toEqual({
      status: "password-required",
      wrongPassword: false,
    });
    expect(applier2.probePdf(new Uint8Array([1]), "wrong")).toEqual({
      status: "password-required",
      wrongPassword: true,
    });
    expect(applier2.probePdf(new Uint8Array([1]), "secret")).toEqual({
      status: "ready",
    });
  });

  it("returns source bytes untouched when overlays is empty", () => {
    const qpdf = new FakeQpdfRunner(() => ({ code: 0, stderr: "" }));
    const applier = new QpdfOverlayApplier(qpdf);
    const src = new Uint8Array([10, 20, 30]);
    expect(applier.applyOverlays(src, "", [])).toBe(src);
    expect(qpdf.runs).toHaveLength(0);
  });

  it("overlays a single stamp page directly and cleans up scratch files", () => {
    const qpdf = new FakeQpdfRunner((args, files) => {
      files.set(args[args.length - 1], new Uint8Array([37, 80, 68, 70]));
      return { code: 0, stderr: "" };
    });
    const applier = new QpdfOverlayApplier(qpdf);
    const out = applier.applyOverlays(new Uint8Array([1]), "pw", [
      { pageIndex: 2, overlayPdf: new Uint8Array([2]) },
    ]);
    expect(Array.from(out)).toEqual([37, 80, 68, 70]);
    expect(qpdf.runs).toEqual([
      [
        "--password=pw",
        "/job-ocr-apply-1-in.pdf",
        "--overlay",
        "/ocr-apply-1-stamp-0.pdf",
        "--to=3",
        "--from=1",
        "--",
        "/job-ocr-apply-1-out.pdf",
      ],
    ]);
    expect(qpdf.files.size).toBe(0);
  });

  it("merges multiple overlay pages into a stamp PDF before overlaying", () => {
    const qpdf = new FakeQpdfRunner((args, files) => {
      files.set(args[args.length - 1], new Uint8Array([37, 80]));
      return { code: 0, stderr: "" };
    });
    const applier = new QpdfOverlayApplier(qpdf);
    applier.applyOverlays(new Uint8Array([1]), "", [
      { pageIndex: 0, overlayPdf: new Uint8Array([2]) },
      { pageIndex: 2, overlayPdf: new Uint8Array([3]) },
    ]);
    expect(qpdf.runs).toHaveLength(2);
    expect(qpdf.runs[0]).toEqual([
      "--empty",
      "--pages",
      "/ocr-apply-1-part-0.pdf",
      "1",
      "/ocr-apply-1-part-1.pdf",
      "1",
      "--",
      "/ocr-apply-1-stamp.pdf",
    ]);
    expect(qpdf.runs[1]).toEqual([
      "/job-ocr-apply-1-in.pdf",
      "--overlay",
      "/ocr-apply-1-stamp.pdf",
      "--to=1,3",
      "--from=1-2",
      "--",
      "/job-ocr-apply-1-out.pdf",
    ]);
    expect(qpdf.files.size).toBe(0);
  });
});
