import { describe, expect, it, vi } from "vitest";
import { InvalidOutputPlanError } from "../core/output-plan";
import { PdfOpenError } from "@/lib/pdfium/pdfium-document";
import type { OrganizeRequest } from "../messages";
import {
  createOrganizeHandler,
  handleRequest,
  openFile,
  type Session,
} from "./organize-handler";

const info = {
  box: { left: 0, bottom: 0, right: 10, top: 10 },
  rotation: 0 as const,
};

function fakeSession(overrides: Partial<Session> = {}): Session {
  return {
    open: vi.fn(() => [info]),
    render: vi.fn(() => ({
      width: 1,
      height: 1,
      pixels: new Uint8Array([1, 2, 3, 4]),
    })),
    save: vi.fn(() => new Uint8Array([37, 80])),
    close: vi.fn(),
    ...overrides,
  };
}
const ctx = { progress: vi.fn() };

describe("openFile", () => {
  const open = (overrides: Record<string, unknown> = {}) =>
    ({
      op: "open",
      sourceId: "s1",
      data: new ArrayBuffer(1),
      ...overrides,
    }) as Extract<OrganizeRequest, { op: "open" }>;

  it("refuses a request without file bytes before PDFium sees it", () => {
    const session = fakeSession();
    expect(openFile(session, open({ data: "nope" }))).toEqual({
      status: "error",
      reason: "failed",
      message: "No file was received.",
    });
    expect(session.open).not.toHaveBeenCalled();
  });

  it("treats a missing or non-string password as none", () => {
    const session = fakeSession();
    openFile(session, open({ password: 42 }));
    expect(session.open).toHaveBeenCalledWith("s1", expect.any(Uint8Array), "");
  });

  it("splits password errors by whether a password was given", () => {
    const session = fakeSession({
      open: () => {
        throw new PdfOpenError("password");
      },
    });
    expect(openFile(session, open())).toEqual({ status: "password-required" });
    expect(openFile(session, open({ password: "x" }))).toEqual({
      status: "wrong-password",
    });
  });

  it("passes other open failures on, and classifies memory exhaustion", () => {
    const broken = fakeSession({
      open: () => {
        throw new PdfOpenError("format");
      },
    });
    expect(openFile(broken, open())).toMatchObject({
      status: "error",
      reason: "failed",
    });
    const full = fakeSession({
      open: () => {
        throw new RangeError("out of memory");
      },
    });
    expect(openFile(full, open())).toMatchObject({
      reason: "out-of-memory",
      message: expect.stringContaining("while opening the PDF"),
    });
  });
});

describe("handleRequest", () => {
  it("opens a file under its id with its password", () => {
    const session = fakeSession();
    const data = new Uint8Array([1, 2]).buffer;
    const { result } = handleRequest(session, {
      op: "open",
      sourceId: "s1",
      data,
      password: "pw",
    });
    expect(result).toEqual({ status: "opened", pages: [info] });
    expect(session.open).toHaveBeenCalledWith(
      "s1",
      expect.any(Uint8Array),
      "pw",
    );
  });

  it("reports a needed password", () => {
    const session = fakeSession({
      open: () => {
        throw new PdfOpenError("password");
      },
    });
    const { result } = handleRequest(session, {
      op: "open",
      sourceId: "s1",
      data: new ArrayBuffer(1),
    });
    expect(result).toEqual({ status: "password-required" });
  });

  it("renders and transfers the pixels; an unknown rotation counts as 0", () => {
    const session = fakeSession();
    const { result, transfer } = handleRequest(session, {
      op: "render",
      sourceId: "s1",
      pageIndex: 2,
      rotation: 7,
      width: 300,
    } as unknown as OrganizeRequest);
    expect(result).toMatchObject({ status: "rendered", width: 1, height: 1 });
    expect(transfer).toHaveLength(1);
    expect(session.render).toHaveBeenCalledWith("s1", 2, 0, 300);
  });

  it("saves and transfers the file", () => {
    const session = fakeSession();
    const pages = [
      { kind: "blank" as const, width: 10, height: 10, rotation: 0 as const },
    ];
    const { result, transfer } = handleRequest(session, { op: "save", pages });
    expect(result.status).toBe("saved");
    expect(transfer).toHaveLength(1);
    expect(session.save).toHaveBeenCalledWith(pages);
  });

  it("closes one file or all", () => {
    const session = fakeSession();
    expect(
      handleRequest(session, { op: "close", sourceId: "s1" }).result,
    ).toEqual({
      status: "closed",
    });
    handleRequest(session, { op: "close" });
    expect(session.close).toHaveBeenNthCalledWith(1, "s1");
    expect(session.close).toHaveBeenNthCalledWith(2, undefined);
  });

  it("answers an unknown op with an error", () => {
    const { result } = handleRequest(fakeSession(), {
      op: "explode",
    } as unknown as OrganizeRequest);
    expect(result).toMatchObject({ status: "error", reason: "failed" });
  });
});

describe("createOrganizeHandler", () => {
  it("turns every exception into a typed result", async () => {
    const handler = createOrganizeHandler(async () =>
      fakeSession({
        save: () => {
          throw new InvalidOutputPlanError("there are no pages");
        },
        render: () => {
          throw new RangeError("out of memory");
        },
      }),
    );
    expect((await handler({ op: "save", pages: [] }, ctx)).result).toEqual({
      status: "error",
      reason: "failed",
      message: "Could not build the PDF: there are no pages",
    });
    const render = await handler(
      { op: "render", sourceId: "a", pageIndex: 0, rotation: 0, width: 1 },
      ctx,
    );
    expect(render.result).toMatchObject({ reason: "out-of-memory" });
  });

  it("reports an engine that failed to load, except for close", async () => {
    const handler = createOrganizeHandler(() =>
      Promise.reject(new Error("offline")),
    );
    expect(
      (
        await handler(
          { op: "open", sourceId: "a", data: new ArrayBuffer(1) },
          ctx,
        )
      ).result,
    ).toEqual({
      status: "error",
      reason: "failed",
      message: "Could not load the PDF engine: offline",
    });
    expect((await handler({ op: "close" }, ctx)).result).toEqual({
      status: "closed",
    });
  });
});
