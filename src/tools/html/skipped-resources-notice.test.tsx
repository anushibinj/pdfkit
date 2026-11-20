import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NO_SKIPPED_RESOURCES } from "./core/skipped-resources";
import { SkippedResourcesNotice } from "./skipped-resources-notice";

describe("SkippedResourcesNotice", () => {
  it("renders nothing for a self-contained document", () => {
    const { container } = render(
      <SkippedResourcesNotice skipped={NO_SKIPPED_RESOURCES} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists what was left out, as a note", () => {
    render(
      <SkippedResourcesNotice
        skipped={{ images: 1, stylesheets: 0, scripts: 2 }}
      />,
    );
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Some content is not in the PDF");
    const items = within(note).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(/^1 image was left out/);
    expect(items[1]).toHaveTextContent(/^2 scripts were not run/);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
