import { describe, expect, it } from "vitest";
import { getTool, tools } from "./registry";

describe("tool registry", () => {
  it("has at least one tool", () => {
    expect(tools.length).toBeGreaterThan(0);
  });

  it("has unique, URL-safe slugs", () => {
    const slugs = tools.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it.each(tools.map((t) => [t.slug, t] as const))(
    "%s has every required field",
    (_slug, tool) => {
      expect(tool.name.trim()).not.toBe("");
      expect(tool.tagline.trim()).not.toBe("");
      expect(tool.keywords.length).toBeGreaterThan(0);
      expect(tool.icon).toBeTruthy();
      expect(typeof tool.component).toBe("function");
      expect(tool.faq.length).toBeGreaterThan(0);
      for (const item of tool.faq) {
        expect(item.q.trim()).not.toBe("");
        expect(item.a.trim()).not.toBe("");
      }
    },
  );

  it.each(tools.map((t) => [t.slug, t.description] as const))(
    "%s description is 150-160 characters",
    (_slug, description) => {
      expect(description.length).toBeGreaterThanOrEqual(150);
      expect(description.length).toBeLessThanOrEqual(160);
    },
  );

  it("looks tools up by slug", () => {
    expect(getTool("unlock")?.name).toBe("PDF Unlocker");
    expect(getTool("nope")).toBeUndefined();
  });
});
