import {
  describePasswordProblem,
  findPasswordProblem,
  mayBeAlteredByReaders,
} from "./password-policy";

/** What the password form should show right now. */
export interface PasswordFeedback {
  /** Error under the password field, if any. */
  passwordError?: string;
  /** Error under the confirmation field, if any. */
  confirmationError?: string;
  /** Show the "some PDF apps may not accept this password" warning. */
  compatibilityWarning: boolean;
}

/**
 * Decide which messages the form shows while someone types.
 *
 * The aim is to point out real problems early without nagging:
 * - An empty password is not shown as an error: the "Protect" button is
 *   simply disabled until there is one.
 * - A password that is too long or contains an unsupported character is
 *   flagged under the password field as soon as it happens.
 * - A mismatch is flagged under the confirmation field as soon as the
 *   confirmation can no longer become the password: when it is not a prefix
 *   of the password (a typo), or when it is at least as long but different.
 *   Typing the right password, one character at a time, never shows it.
 *   It is not shown while the password itself has a problem.
 * - The compatibility warning appears only for an otherwise valid password.
 *
 * @param password The password field's value.
 * @param confirmation The confirmation field's value.
 * @returns The messages to show.
 */
export function passwordFeedback(
  password: string,
  confirmation: string,
): PasswordFeedback {
  const problem = password.length > 0 ? findPasswordProblem(password) : null;
  if (problem) {
    return {
      passwordError: describePasswordProblem(problem),
      compatibilityWarning: false,
    };
  }
  const diverged =
    confirmation.length > 0 &&
    (!password.startsWith(confirmation) ||
      confirmation.length >= password.length) &&
    confirmation !== password;
  return {
    confirmationError: diverged
      ? describePasswordProblem("mismatch")
      : undefined,
    compatibilityWarning:
      password.length > 0 && mayBeAlteredByReaders(password),
  };
}
