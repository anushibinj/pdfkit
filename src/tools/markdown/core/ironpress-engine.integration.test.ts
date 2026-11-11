// @vitest-environment node
/**
 * Runs the real ironpress WebAssembly build (from node_modules) to pin down
 * the behaviour this tool relies on. If an ironpress upgrade changes any of
 * it, these tests fail before users notice.
 */
import init, { HtmlConverter } from "ironpress/node";
import { beforeAll, describe, expect, it } from "vitest";
import { allStreamText, pageSizes } from "../test-utils/pdf-inspect";
import { IronpressEngine } from "./ironpress-engine";

const doc = (css: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;

let engine: IronpressEngine;

beforeAll(async () => {
  await init();
  engine = new IronpressEngine({ HtmlConverter });
}, 60_000);

describe("IronpressEngine with the real WASM build", () => {
  it("produces a PDF file", () => {
    const pdf = engine.render(doc("", "<p>Hello</p>"), {
      size: "A4",
      marginMm: 20,
    });
    expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  });

  it("applies CSS from a <style> element", () => {
    const page = { size: "A4", marginMm: 20 } as const;
    const plain = allStreamText(engine.render(doc("", "<h1>Hi</h1>"), page));
    const red = allStreamText(
      engine.render(doc("h1 { color: #ff0000; }", "<h1>Hi</h1>"), page),
    );
    // "1 0 0 rg" sets the non-stroking (text fill) colour to pure red.
    expect(plain).not.toMatch(/\b1 0 0 rg\b/);
    expect(red).toMatch(/\b1 0 0 rg\b/);
  });

  it.each([
    ["A4", 595, 842],
    ["Letter", 612, 792],
    ["Legal", 612, 1008],
  ] as const)("uses %s paper", async (size, width, height) => {
    const pdf = engine.render(doc("", "<p>x</p>"), { size, marginMm: 10 });
    expect(await pageSizes(pdf)).toEqual([{ width, height }]);
  });

  it("flows long documents onto more pages", async () => {
    const body = Array.from(
      { length: 300 },
      (_, i) => `<p>Paragraph ${i}</p>`,
    ).join("");
    const pdf = engine.render(doc("", body), { size: "A4", marginMm: 20 });
    expect((await pageSizes(pdf)).length).toBeGreaterThan(1);
  });

  it("bigger margins push content onto more pages", async () => {
    const body = Array.from({ length: 120 }, (_, i) => `<p>Line ${i}</p>`).join(
      "",
    );
    const narrow = await pageSizes(
      engine.render(doc("", body), { size: "A4", marginMm: 5 }),
    );
    const wide = await pageSizes(
      engine.render(doc("", body), { size: "A4", marginMm: 50 }),
    );
    expect(wide.length).toBeGreaterThan(narrow.length);
  });

  it("lets an @page rule in the CSS override the requested paper size", async () => {
    const pdf = engine.render(doc("@page { size: A5; }", "<p>x</p>"), {
      size: "A4",
      marginMm: 20,
    });
    expect(await pageSizes(pdf)).toEqual([{ width: 420, height: 595 }]);
  });

  it("tolerates malformed CSS and an empty document", () => {
    const page = { size: "A4", marginMm: 20 } as const;
    expect(() =>
      engine.render(doc("h1 { color: ;;; }}}", "<p>x</p>"), page),
    ).not.toThrow();
    expect(() => engine.render("", page)).not.toThrow();
  });

  it("maps the generic font families to embedded Liberation fonts", () => {
    const page = { size: "A4", marginMm: 20 } as const;
    const fontOf = (family: string) =>
      Buffer.from(
        engine.render(
          doc(`body { font-family: ${family}; }`, "<p>x</p>"),
          page,
        ),
      )
        .toString("latin1")
        .match(/\/BaseFont \/[A-Z]{6}\+(Liberation\w+)/)?.[1];
    expect(fontOf("sans-serif")).toBe("LiberationSans");
    expect(fontOf("serif")).toBe("LiberationSerif");
    expect(fontOf("monospace")).toBe("LiberationMono");
  });

  it("frees the converter even when ironpress throws", () => {
    let freed = 0;
    class Counting extends HtmlConverter {
      free() {
        freed++;
        super.free();
      }
      pageSize(): void {
        throw new Error("bad size");
      }
    }
    const failing = new IronpressEngine({ HtmlConverter: Counting });
    expect(() =>
      failing.render(doc("", "<p>x</p>"), { size: "A4", marginMm: 0 }),
    ).toThrow("bad size");
    expect(freed).toBe(1);
  });
});
