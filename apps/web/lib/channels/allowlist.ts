/** IDs match exactly; Telegram usernames ignore case and an optional leading @. */
export function isSenderAllowed(
  allowed: string[] | undefined,
  sender: { id: string; username?: string }
): boolean {
  if (allowed === undefined) return true;
  // Fail closed if legacy or externally written config is malformed.
  if (!Array.isArray(allowed)) return false;
  if (allowed.length === 0) return true;
  const username = sender.username?.replace(/^@/, "").toLowerCase();
  return allowed.some(
    (entry) =>
      typeof entry === "string" &&
      (entry === sender.id ||
        (Boolean(username) && entry.replace(/^@/, "").toLowerCase() === username))
  );
}
