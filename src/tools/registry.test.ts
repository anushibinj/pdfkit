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

  it("flags the signature verifier as beta and the unlocker as stable", () => {
    expect(getTool("verify")?.beta).toBe(true);
    expect(getTool("unlock")?.beta).toBeFalsy();
  });

  it("registers the Markdown to PDF converter as a beta tool", () => {
    const tool = getTool("markdown-to-pdf");
    expect(tool?.name).toBe("Markdown to PDF");
    expect(tool?.beta).toBe(true);
  });

  it("registers the HTML to PDF converter as a beta tool", () => {
    const tool = getTool("html-to-pdf");
    expect(tool?.name).toBe("HTML to PDF");
    expect(tool?.beta).toBe(true);
  });

  it("registers the PDF editor as a beta tool", () => {
    const tool = getTool("edit");
    expect(tool?.name).toBe("PDF Editor");
    expect(tool?.beta).toBe(true);
  });

  it("loads the PDF editor component lazily", async () => {
    const mod = await getTool("edit")!.component();
    expect(typeof mod.default).toBe("function");
  });

  it("loads the HTML to PDF component lazily", async () => {
    const mod = await getTool("html-to-pdf")!.component();
    expect(typeof mod.default).toBe("function");
  });

  it("registers Protect PDF as a beta tool", () => {
    const tool = getTool("protect");
    expect(tool?.name).toBe("Protect PDF");
    expect(tool?.beta).toBe(true);
  });

  it("loads the Protect PDF component lazily", async () => {
    const mod = await getTool("protect")!.component();
    expect(typeof mod.default).toBe("function");
  });

  it("registers the watermark tool as a beta tool", () => {
    const tool = getTool("watermark");
    expect(tool?.name).toBe("Add Watermark");
    expect(tool?.beta).toBe(true);
  });

  it("loads the watermark component lazily", async () => {
    const mod = await getTool("watermark")!.component();
    expect(typeof mod.default).toBe("function");
  });

  it("registers the PDF splitter as a beta tool", () => {
    const tool = getTool("split");
    expect(tool?.name).toBe("Split PDF");
    expect(tool?.beta).toBe(true);
  });

  it("loads the PDF splitter component lazily", async () => {
    const mod = await getTool("split")!.component();
    expect(typeof mod.default).toBe("function");
  });

  it("registers Merge PDFs as a beta tool", () => {
    const tool = getTool("merge");
    expect(tool?.name).toBe("Merge PDFs");
    expect(tool?.beta).toBe(true);
  });

  it("loads the Merge PDFs component lazily", async () => {
    const mod = await getTool("merge")!.component();
    expect(typeof mod.default).toBe("function");
  });

  it("loads the Markdown to PDF component lazily", async () => {
    const mod = await getTool("markdown-to-pdf")!.component();
    expect(typeof mod.default).toBe("function");
  });

  it("registers the page organizer as a beta tool", () => {
    const tool = getTool("organize");
    expect(tool?.name).toBe("Organize Pages");
    expect(tool?.beta).toBe(true);
  });

  it("loads the page organizer component lazily", async () => {
    const mod = await getTool("organize")!.component();
    expect(typeof mod.default).toBe("function");
  });
});
