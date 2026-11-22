import { describe, expect, it } from "vitest";
import {
  BROWSER_DEFAULTS_CSS,
  BROWSER_DEFAULTS_STYLE,
  leadingDoctypeEnd,
  withBrowserDefaults,
} from "./browser-defaults";

describe("BROWSER_DEFAULTS_CSS", () => {
  it("wraps every selector in :where() so document rules always win", () => {
    const rules = BROWSER_DEFAULTS_CSS.split("\n");
    expect(rules).toHaveLength(3);
    for (const rule of rules)
      expect(rule).toMatch(/^:where\(.+\) \{ display: none; \}$/);
  });
});

describe("leadingDoctypeEnd", () => {
  it.each([
    ["<!doctype html><p>x</p>", "<!doctype html>".length],
    ["<!DOCTYPE html>\n<html>", "<!DOCTYPE html>".length],
    ["\uFEFF<!doctype html><p>", "\uFEFF<!doctype html>".length],
    ["  \n\t<!doctype html>", "  \n\t<!doctype html>".length],
    [
      "<!-- a --><!-- b --><!doctype html>x",
      "<!-- a --><!-- b --><!doctype html>".length,
    ],
    ["<!--><!doctype html>", "<!--><!doctype html>".length],
    [
      "<?xml version='1.0'?><!DOCTYPE html PUBLIC '-//W3C//DTD XHTML 1.0//EN' 'x.dtd'><html>",
      "<?xml version='1.0'?><!DOCTYPE html PUBLIC '-//W3C//DTD XHTML 1.0//EN' 'x.dtd'>"
        .length,
    ],
  ])("finds the end of the doctype in %j", (html, end) => {
    expect(leadingDoctypeEnd(html)).toBe(end);
  });

  it.each([
    "",
    "<p>no doctype</p>",
    "<html><!doctype html>",
    "<!-- unterminated <!doctype html>",
    "<?xml unterminated <!doctype html",
    "<!doctype html",
    "<!doctyp html>",
  ])("returns 0 when %j does not start with a complete doctype", (html) => {
    expect(leadingDoctypeEnd(html)).toBe(0);
  });

  it("stays fast on many comments with no doctype", () => {
    // An exponential-time regular expression would never finish this.
    const html = "<!-- c -->".repeat(50_000) + "<p>x</p>";
    const start = performance.now();
    expect(leadingDoctypeEnd(html)).toBe(0);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe("withBrowserDefaults", () => {
  it("inserts the style element right after the doctype", () => {
    expect(withBrowserDefaults("<!doctype html><p>x</p>")).toBe(
      `<!doctype html>${BROWSER_DEFAULTS_STYLE}<p>x</p>`,
    );
  });

  it("puts it first in a fragment, so an unclosed element cannot swallow it", () => {
    expect(withBrowserDefaults("<textarea>notes")).toBe(
      `${BROWSER_DEFAULTS_STYLE}<textarea>notes`,
    );
  });

  it("handles empty input", () => {
    expect(withBrowserDefaults("")).toBe(BROWSER_DEFAULTS_STYLE);
  });
});
