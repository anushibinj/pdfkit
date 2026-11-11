import { marked } from "marked";
import { afterEach, describe, expect, it } from "vitest";
import { MarkedMarkdownRenderer } from "./markdown-renderer";

describe("MarkedMarkdownRenderer", () => {
  const renderer = new MarkedMarkdownRenderer();

  it("renders CommonMark", () => {
    const html = renderer.render("# Title\n\nSome *em* and **strong** `code`.");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<em>em</em>");
    expect(html).toContain("<strong>strong</strong>");
    expect(html).toContain("<code>code</code>");
  });

  it("renders GitHub Flavored Markdown tables, strikethrough and task lists", () => {
    const html = renderer.render(
      "| a | b |\n| - | - |\n| 1 | 2 |\n\n~~gone~~\n\n- [x] done\n- [ ] todo",
    );
    expect(html).toContain("<table>");
    expect(html).toContain("<td>1</td>");
    expect(html).toContain("<del>gone</del>");
    expect(html).toMatch(
      /<input[^>]*checked[^>]*type="checkbox"|<input[^>]*type="checkbox"[^>]*checked/,
    );
  });

  it("escapes HTML inside code blocks", () => {
    expect(renderer.render("```\n<b>x</b>\n```")).toContain(
      "&lt;b&gt;x&lt;/b&gt;",
    );
  });

  it("does not turn single newlines into <br>", () => {
    expect(renderer.render("one\ntwo")).not.toContain("<br>");
  });

  it("returns an empty string for empty input", () => {
    expect(renderer.render("")).toBe("");
  });

  describe("isolation from the global marked instance", () => {
    afterEach(() => {
      marked.setOptions(marked.getDefaults());
    });

    it("ignores global marked options", () => {
      marked.setOptions({ breaks: true });
      expect(new MarkedMarkdownRenderer().render("one\ntwo")).not.toContain(
        "<br>",
      );
    });
  });
});
