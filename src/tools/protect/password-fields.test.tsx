import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { PasswordFields } from "./password-fields";

/** Renders the fields with real state, like the tool page does. */
function Harness({
  initial = ["", ""],
  disabled,
}: {
  initial?: [string, string];
  disabled?: boolean;
}) {
  const [password, setPassword] = useState(initial[0]);
  const [confirmation, setConfirmation] = useState(initial[1]);
  return (
    <PasswordFields
      password={password}
      confirmation={confirmation}
      onPasswordChange={setPassword}
      onConfirmationChange={setConfirmation}
      disabled={disabled}
    />
  );
}

const passwordBox = () => screen.getByLabelText("Password") as HTMLInputElement;
const confirmBox = () =>
  screen.getByLabelText("Confirm password") as HTMLInputElement;

describe("PasswordFields", () => {
  it("renders two masked new-password fields with a hint", () => {
    render(<Harness />);
    for (const box of [passwordBox(), confirmBox()]) {
      expect(box.type).toBe("password");
      expect(box.autocomplete).toBe("new-password");
    }
    expect(passwordBox()).toHaveAccessibleDescription(/cannot be recovered/);
  });

  it("reports each field's changes", () => {
    const onPasswordChange = vi.fn();
    const onConfirmationChange = vi.fn();
    render(
      <PasswordFields
        password=""
        confirmation=""
        onPasswordChange={onPasswordChange}
        onConfirmationChange={onConfirmationChange}
      />,
    );
    fireEvent.change(passwordBox(), { target: { value: "a" } });
    fireEvent.change(confirmBox(), { target: { value: "b" } });
    expect(onPasswordChange).toHaveBeenCalledWith("a");
    expect(onConfirmationChange).toHaveBeenCalledWith("b");
  });

  it("shows and hides both passwords", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const toggle = screen.getByRole("button", { name: "Show passwords" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(passwordBox().type).toBe("text");
    expect(confirmBox().type).toBe("text");
    await user.click(toggle);
    expect(passwordBox().type).toBe("password");
  });

  it("flags a mismatch on the confirmation field", () => {
    render(<Harness initial={["hunter2", "hunter3"]} />);
    expect(confirmBox()).toHaveAttribute("aria-invalid", "true");
    expect(confirmBox()).toHaveAccessibleDescription(
      "The passwords do not match.",
    );
    expect(passwordBox()).not.toHaveAttribute("aria-invalid");
  });

  it("flags a password that is too long", () => {
    render(<Harness initial={["x".repeat(128), ""]} />);
    expect(passwordBox()).toHaveAttribute("aria-invalid", "true");
    expect(passwordBox()).toHaveAccessibleDescription(/too long/);
  });

  it("warns about characters some PDF apps convert", () => {
    render(<Harness initial={["pass²", ""]} />);
    expect(passwordBox()).toHaveAccessibleDescription(
      /Some PDF apps may not accept/,
    );
    expect(passwordBox()).not.toHaveAttribute("aria-invalid");
  });

  it("disables both fields", () => {
    render(<Harness disabled />);
    expect(passwordBox()).toBeDisabled();
    expect(confirmBox()).toBeDisabled();
  });
});
