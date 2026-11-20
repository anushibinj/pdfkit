"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { passwordFeedback } from "./core/password-feedback";

interface PasswordFieldsProps {
  password: string;
  confirmation: string;
  onPasswordChange: (value: string) => void;
  onConfirmationChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * The new password, typed twice, with a show/hide toggle.
 *
 * Typing it twice matters more here than on most forms: a typo would lock
 * the person out of their own document, and nothing can recover it. The
 * fields use `autoComplete="new-password"`, which lets a password manager
 * offer a strong password and remember it.
 *
 * Messages are worked out by `passwordFeedback` and tied to their field with
 * `aria-describedby`, so screen readers read them with the field.
 *
 * @param props The two values, their change handlers, and `disabled`.
 * @returns The fields.
 */
export function PasswordFields({
  password,
  confirmation,
  onPasswordChange,
  onConfirmationChange,
  disabled,
}: PasswordFieldsProps) {
  const [visible, setVisible] = useState(false);
  const passwordId = useId();
  const hintId = useId();
  const passwordErrorId = useId();
  const warningId = useId();
  const confirmationId = useId();
  const confirmationErrorId = useId();
  const feedback = passwordFeedback(password, confirmation);
  const type = visible ? "text" : "password";

  /** Join the ids of the messages currently shown for a field. */
  const describedBy = (...ids: (string | false | undefined)[]) =>
    ids.filter(Boolean).join(" ") || undefined;

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={passwordId} className="text-sm font-medium">
            Password
          </label>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11"
            aria-pressed={visible}
            onClick={() => setVisible((v) => !v)}
          >
            {visible ? (
              <EyeOff aria-hidden="true" />
            ) : (
              <Eye aria-hidden="true" />
            )}
            Show passwords
          </Button>
        </div>
        <Input
          id={passwordId}
          type={type}
          autoComplete="new-password"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          disabled={disabled}
          aria-invalid={feedback.passwordError ? true : undefined}
          aria-describedby={describedBy(
            hintId,
            feedback.passwordError && passwordErrorId,
            feedback.compatibilityWarning && warningId,
          )}
          className="h-11 text-base"
        />
        <p id={hintId} className="text-muted-foreground text-sm">
          Anyone who opens the PDF will need this password. It cannot be
          recovered if you forget it.
        </p>
        {feedback.passwordError && (
          <p id={passwordErrorId} className="text-destructive text-sm">
            {feedback.passwordError}
          </p>
        )}
        {feedback.compatibilityWarning && (
          <p
            id={warningId}
            className="text-sm text-amber-700 dark:text-amber-300"
          >
            Some PDF apps may not accept this password: it contains characters
            they are required to convert first, such as superscripts, full-width
            letters, special spaces or emoji variation marks. Letters, digits
            and common symbols work everywhere.
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <label htmlFor={confirmationId} className="text-sm font-medium">
          Confirm password
        </label>
        <Input
          id={confirmationId}
          type={type}
          autoComplete="new-password"
          value={confirmation}
          onChange={(e) => onConfirmationChange(e.target.value)}
          disabled={disabled}
          aria-invalid={feedback.confirmationError ? true : undefined}
          aria-describedby={describedBy(
            feedback.confirmationError && confirmationErrorId,
          )}
          className="h-11 text-base"
        />
        {feedback.confirmationError && (
          <p id={confirmationErrorId} className="text-destructive text-sm">
            {feedback.confirmationError}
          </p>
        )}
      </div>
    </div>
  );
}
