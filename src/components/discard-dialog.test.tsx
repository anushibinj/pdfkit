import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DiscardDialog } from "./discard-dialog";

describe("DiscardDialog", () => {
  it("offers to keep editing or discard", async () => {
    const user = userEvent.setup();
    const onKeep = vi.fn();
    const onDiscard = vi.fn();
    const { rerender } = render(
      <DiscardDialog open onKeep={onKeep} onDiscard={onDiscard} />,
    );
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    await user.click(screen.getByRole("button", { name: "Discard edits" }));
    expect(onKeep).toHaveBeenCalled();
    expect(onDiscard).toHaveBeenCalled();
    rerender(
      <DiscardDialog open={false} onKeep={onKeep} onDiscard={onDiscard} />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows custom wording when given", async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn();
    render(
      <DiscardDialog
        open
        onKeep={vi.fn()}
        onDiscard={onDiscard}
        title="Start over?"
        description="The board has not been downloaded."
        keepLabel="Keep the board"
        discardLabel="Start over"
      />,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("Start over?");
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "The board has not been downloaded.",
    );
    expect(
      screen.getByRole("button", { name: "Keep the board" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Start over" }));
    expect(onDiscard).toHaveBeenCalled();
  });
});
