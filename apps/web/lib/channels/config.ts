import { z } from "zod";

export const channelConfigSchema = z
  .object({
    allowedSenders: z.array(z.string().trim().min(1).max(256)).max(200).optional(),
    /**
     * Let anyone who finds the channel talk to its agent. Only consulted when
     * `allowedSenders` is empty or absent, where it used to be the implicit
     * default. Opening a channel is a decision; this is where it is recorded.
     */
    allowAnySender: z.boolean().optional(),
    /** Discord slash command name. Discord only accepts lowercase and no spaces. */
    commandName: z
      .string()
      .trim()
      .regex(/^[-_a-z0-9]{1,32}$/, "Lowercase letters, digits, - and _ only; up to 32 characters")
      .optional(),
    /** Discord: post answers for the whole channel to read. Default private. */
    publicReplies: z.boolean().optional(),
    /**
     * Discord: which servers the command answers in. Snowflakes.
     *
     * Absent means no restriction — unlike `allowedSenders`, where empty
     * denies. `allowedSenders` has already decided *who*; this narrows
     * *where*, and it matters most with `publicReplies` on, where the agent's
     * answer is posted for a whole server to read.
     */
    allowedGuilds: z
      .array(
        z
          .string()
          .trim()
          .regex(/^\d{5,}$/)
      )
      .max(100)
      .optional(),
    /** Discord: which channels inside those servers. Same semantics. */
    allowedChannels: z
      .array(
        z
          .string()
          .trim()
          .regex(/^\d{5,}$/)
      )
      .max(200)
      .optional(),
  })
  .catchall(z.unknown());
