import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BetaNotice } from "./beta-notice";

describe("BetaNotice", () => {
  it("is a note with the title and a bulleted list of limits", () => {
    render(
      <BetaNotice title="Beta: limits">
        <li>First limit</li>
        <li>Second limit</li>
      </BetaNotice>,
    );
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Beta: limits");
    const items = within(within(note).getByRole("list")).getAllByRole(
      "listitem",
    );
    expect(items.map((li) => li.textContent)).toEqual([
      "First limit",
      "Second limit",
    ]);
    // a note, not an alert: it must not interrupt screen readers on load
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
