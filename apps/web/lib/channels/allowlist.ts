/**
 * An entry that looks like an account ID: digits only, long enough not to be a
 * word. A Discord snowflake is 17-19 digits; a Telegram chat ID is up to 13,
 * negative for groups.
 */
const LOOKS_LIKE_AN_ID = /^-?\d{5,}$/;

/** IDs match exactly; usernames ignore case and an optional leading @. */
export function isSenderAllowed(
  allowed: string[] | undefined,
  sender: { id: string; username?: string }
): boolean {
  if (allowed === undefined) return true;
  // Fail closed if legacy or externally written config is malformed.
  if (!Array.isArray(allowed)) return false;
  if (allowed.length === 0) return true;
  const username = sender.username?.replace(/^@/, "").toLowerCase();
  return allowed.some((entry) => {
    if (typeof entry !== "string") return false;
    if (entry === sender.id) return true;
    // An ID-shaped entry never matches a username. A Discord username may be
    // all digits and is freely changeable, so without this an attacker renames
    // themselves to an allowlisted user's ID and walks straight in.
    if (LOOKS_LIKE_AN_ID.test(entry)) return false;
    return Boolean(username) && entry.replace(/^@/, "").toLowerCase() === username;
  });
}
