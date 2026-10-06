/**
 * Where a Discord command is allowed to be run, as opposed to who may run it.
 *
 * `isSenderAllowed` answers "who", and that is not the same question. The case
 * this exists for: an allowlisted person runs the command in a **public**
 * channel of a server the bot also happens to be in, with
 * `config.publicReplies` on — and the agent's answer, which may carry company
 * data, gets posted for everyone there to read. The sender gate cannot see
 * that, because the sender is legitimate.
 *
 * Until now `guild_id` and `channel_id` were only recorded in the
 * conversation's metadata. They were never checked.
 *
 * **Absent means no restriction, unlike `allowedSenders`.** The asymmetry is
 * deliberate and worth stating, because the two gates answer different
 * questions. An unconfigured `allowedSenders` leaves the door open to anyone
 * who finds the bot — a Discord bot is reachable by anyone in a shared server
 * — so empty has to deny. Here the sender gate has already run and the person
 * is trusted; narrowing *where* they may talk is defence in depth, and
 * defaulting it to deny would break every channel that works today for a
 * danger that only exists once someone turns on public replies.
 */

/** A Discord snowflake: digits only, 17-19 of them in practice. */
const SNOWFLAKE = /^\d{5,}$/;

export type LugarCheck = "ok" | "guild-no-permitido" | "canal-no-permitido";

function permite(lista: unknown, valor: string | undefined): boolean {
  // Not configured at all: no restriction on this dimension.
  if (lista === undefined) return true;
  // Malformed config (this is a free-form jsonb column, so it is reachable
  // without a code change). Fail closed, same as the sender gate.
  if (!Array.isArray(lista)) return false;
  if (lista.length === 0) return true;
  if (!valor) return false;
  return lista.some((e) => typeof e === "string" && e.trim() === valor && SNOWFLAKE.test(valor));
}

/**
 * Whether this interaction may run where it arrived from.
 *
 * Returns which dimension refused, not a boolean: the two refusals need
 * different wording for the person to know what to do about it, and a caller
 * that only sees `false` ends up writing "not allowed" for both.
 */
export function lugarPermitido(
  config: Record<string, unknown> | null | undefined,
  // `| undefined` written out because the repo runs with
  // `exactOptionalPropertyTypes`: a caller reading these off a parsed Discord
  // payload has them as `string | undefined`, and `?:` alone rejects that.
  lugar: {
    guildId?: string | undefined;
    channelId?: string | undefined;
    /**
     * The thread's parent channel, when the command ran inside a thread.
     *
     * A thread is a channel with its own id, so allowlisting `#dev-alerts`
     * would otherwise refuse every thread opened inside it — the filter would
     * work backwards for the one place we most want a conversation to happen.
     *
     * Discord's docs do not say whether an interaction's `channel_id` is the
     * thread or the parent. They do say the partial `channel` object carries
     * `parent_id`. So this checks **both** and does not need the answer: list
     * the parent and threads work; list the thread and it works too.
     */
    parentId?: string | undefined;
  }
): LugarCheck {
  if (!permite(config?.["allowedGuilds"], lugar.guildId)) return "guild-no-permitido";
  const canalOk =
    permite(config?.["allowedChannels"], lugar.channelId) ||
    (lugar.parentId !== undefined && permite(config?.["allowedChannels"], lugar.parentId));
  if (!canalOk) return "canal-no-permitido";
  return "ok";
}
