import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DiscardDialog } from "./discard-dialog";
import { PasswordPrompt } from "./password-prompt";

describe("PasswordPrompt", () => {
  it("submits the typed password", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <PasswordPrompt
        fileName="locked.pdf"
        wrong={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("locked.pdf");
    const open = screen.getByRole("button", { name: "Open" });
    expect(open).toBeDisabled();
    await user.type(screen.getByLabelText("Password"), "hunter2");
    await user.click(open);
    expect(onSubmit).toHaveBeenCalledWith("hunter2");
  });

  it("flags a wrong password and can be cancelled", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <PasswordPrompt
        fileName="a.pdf"
        wrong
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Wrong password");
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("says by default that the edited file keeps the password", () => {
    render(
      <PasswordPrompt
        fileName="a.pdf"
        wrong={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "the edited file keeps the same password",
    );
  });

  it("shows a custom note and cancel label", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <PasswordPrompt
        fileName="a.pdf"
        wrong={false}
        onSubmit={vi.fn()}
        onCancel={onCancel}
        note="The organized file has no password."
        cancelLabel="Skip this file"
      />,
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "The organized file has no password.",
    );
    expect(screen.getByRole("dialog")).not.toHaveTextContent("keeps the same");
    await user.click(screen.getByRole("button", { name: "Skip this file" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("does not submit twice while busy", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <PasswordPrompt
        fileName="a.pdf"
        wrong={false}
        busy
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Password"), "x{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Opening…" })).toBeDisabled();
  });
});

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
