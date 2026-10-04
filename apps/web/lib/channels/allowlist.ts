/**
 * An entry that looks like an account ID: digits only, long enough not to be a
 * word. A Discord snowflake is 17-19 digits; a Telegram chat ID is up to 13,
 * negative for groups.
 */
const LOOKS_LIKE_AN_ID = /^-?\d{5,}$/;

/**
 * Whether this sender may talk to the channel's agent.
 *
 * **An empty allowlist denies.** It used to allow, and that conflated two very
 * different situations: "nobody has configured this yet" and "this is meant to
 * be open". The difference matters because a Telegram bot is addressable by its
 * @name — anyone who finds it is already at the door, no URL secret needed —
 * and because an approval link for a paused `wait_human` run travels through
 * these channels. On the other side of that link can be a merge to production.
 *
 * To open a channel to everyone, set `allowAnySender: true`. Saying it out loud
 * is the point: an open channel is now a decision someone made, visible in the
 * config, instead of the state a channel happens to be born in.
 *
 * Takes the whole `channel.config` rather than the list: the three webhooks
 * that ask this question used to each cast `config.allowedSenders` themselves,
 * and a gate parsed in three places is a gate that drifts in three places.
 */
export function isSenderAllowed(
  config: Record<string, unknown> | null | undefined,
  sender: { id: string; username?: string }
): boolean {
  const allowed = config?.["allowedSenders"];
  const abierto = config?.["allowAnySender"] === true;

  // Fail closed if legacy or externally written config is malformed. `config`
  // is a free-form jsonb column, so this is reachable without a code change.
  if (allowed !== undefined && !Array.isArray(allowed)) return false;

  const lista = (allowed as unknown[] | undefined) ?? [];
  if (lista.length === 0) return abierto;

  const username = sender.username?.replace(/^@/, "").toLowerCase();
  return lista.some((entry) => {
    if (typeof entry !== "string") return false;
    if (entry === sender.id) return true;
    // An ID-shaped entry never matches a username. A Discord username may be
    // all digits and is freely changeable, so without this an attacker renames
    // themselves to an allowlisted user's ID and walks straight in.
    if (LOOKS_LIKE_AN_ID.test(entry)) return false;
    return Boolean(username) && entry.replace(/^@/, "").toLowerCase() === username;
  });
}
