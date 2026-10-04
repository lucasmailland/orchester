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
  })
  .catchall(z.unknown());
