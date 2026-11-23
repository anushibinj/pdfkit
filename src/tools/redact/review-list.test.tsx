import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RedactionMark } from "./core/model";
import { ReviewList } from "./review-list";

const MARKS: RedactionMark[] = [
  {
    id: "m1",
    pageIndex: 0,
    box: { left: 10, bottom: 10, right: 50, top: 20 },
    term: "alice@example.com",
    source: "email",
    label: "Email",
    enabled: true,
  },
  {
    id: "m2",
    pageIndex: 2,
    box: { left: 10, bottom: 10, right: 50, top: 20 },
    term: "2026-01-15",
    source: "date",
    label: "Date",
    enabled: false,
  },
];

describe("ReviewList", () => {
  it("shows empty guidance when there are no marks", () => {
    render(
      <ReviewList
        marks={[]}
        selectedMarkId={null}
        onToggle={vi.fn()}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        onSetAll={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/draw a box on the page or run search/i),
    ).toBeInTheDocument();
  });

  it("renders mark counts and dispatches toggle, select, remove, select-all, and clear", () => {
    const onToggle = vi.fn();
    const onSelect = vi.fn();
    const onRemove = vi.fn();
    const onSetAll = vi.fn();
    const onClear = vi.fn();

    render(
      <ReviewList
        marks={MARKS}
        selectedMarkId="m1"
        onToggle={onToggle}
        onSelect={onSelect}
        onRemove={onRemove}
        onSetAll={onSetAll}
        onClear={onClear}
      />,
    );

    expect(screen.getByText("1 of 2 selected")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("checkbox", { name: /alice@example\.com/i }),
    );
    expect(onToggle).toHaveBeenCalledWith("m1");

    fireEvent.click(screen.getByText("alice@example.com"));
    expect(onSelect).toHaveBeenCalledWith(MARKS[0]);

    fireEvent.click(
      screen.getByRole("button", { name: /remove mark on page 3/i }),
    );
    expect(onRemove).toHaveBeenCalledWith("m2");

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(onSetAll).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
