import { describe, expect, it } from "vitest";
import { IronpressEngine, type IronpressConverter } from "./ironpress-engine";

/** Records every call so the test can assert what the engine asked for. */
function fakeApi(fail?: Error) {
  const calls: string[] = [];
  class FakeConverter implements IronpressConverter {
    pageSize(name: string) {
      calls.push(`pageSize:${name}`);
    }
    marginSides(t: number, r: number, b: number, l: number) {
      calls.push(`margins:${[t, r, b, l].map((n) => n.toFixed(2)).join(",")}`);
    }
    sanitize(enabled: boolean) {
      calls.push(`sanitize:${enabled}`);
    }
    htmlToPdf(html: string) {
      calls.push(`html:${html}`);
      if (fail) throw fail;
      return new Uint8Array([1, 2, 3]);
    }
    free() {
      calls.push("free");
    }
  }
  return { api: { HtmlConverter: FakeConverter }, calls };
}

describe("IronpressEngine", () => {
  it("configures a converter, renders, then frees it", () => {
    const { api, calls } = fakeApi();
    const pdf = new IronpressEngine(api).render("<p>x</p>", {
      size: "Letter",
      marginMm: 25.4,
    });
    expect(Array.from(pdf)).toEqual([1, 2, 3]);
    expect(calls).toEqual([
      "sanitize:true",
      "pageSize:Letter",
      "margins:72.00,72.00,72.00,72.00",
      "html:<p>x</p>",
      "free",
    ]);
  });

  it("frees the converter when rendering throws", () => {
    const { api, calls } = fakeApi(new Error("layout failed"));
    expect(() =>
      new IronpressEngine(api).render("<p>x</p>", { size: "A4", marginMm: 0 }),
    ).toThrow("layout failed");
    expect(calls.at(-1)).toBe("free");
  });

  it("uses a new converter for every document", () => {
    let created = 0;
    const { api } = fakeApi();
    const Base = api.HtmlConverter;
    const counting = {
      HtmlConverter: class extends Base {
        constructor() {
          super();
          created++;
        }
      },
    };
    const engine = new IronpressEngine(counting);
    engine.render("a", { size: "A4", marginMm: 0 });
    engine.render("b", { size: "A4", marginMm: 0 });
    expect(created).toBe(2);
  });
});
