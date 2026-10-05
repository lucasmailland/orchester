/**
 * Who may create an account, set with `SIGNUP_MODE`:
 *
 *   - `open` (default): anyone. A fresh install needs it to create its
 *     first user.
 *   - `invite`: only an email with a pending, unexpired workspace invite.
 *   - `closed`: nobody; existing users can still sign in.
 *
 * An unrecognised value counts as `closed`, so a typo never opens signup.
 * The check runs before better-auth creates any user, so it covers email
 * signup and the first sign-in with a social provider alike.
 */
export type SignupMode = "open" | "invite" | "closed";

const MODES: readonly SignupMode[] = ["open", "invite", "closed"];

export function getSignupMode(raw: string | undefined): SignupMode {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "") return "open";
  return (MODES as readonly string[]).includes(value) ? (value as SignupMode) : "closed";
}

export class SignupNotAllowedError extends Error {
  constructor() {
    super("Signup is not available. Ask a workspace admin for an invite.");
    this.name = "SignupNotAllowedError";
  }
}

export async function assertSignupAllowed(
  email: string,
  mode: SignupMode,
  hasPendingInvite: (normalizedEmail: string) => Promise<boolean>
): Promise<void> {
  if (mode === "open") return;
  if (mode === "closed") throw new SignupNotAllowedError();
  const normalized = email.trim().toLowerCase();
  if (!normalized || !(await hasPendingInvite(normalized))) {
    throw new SignupNotAllowedError();
  }
}
