import { z } from "zod";

export const channelConfigSchema = z
  .object({
    allowedSenders: z.array(z.string().trim().min(1).max(256)).max(200).optional(),
    /** Discord slash command name. Discord only accepts lowercase and no spaces. */
    commandName: z
      .string()
      .trim()
      .regex(/^[-_a-z0-9]{1,32}$/, "Lowercase letters, digits, - and _ only; up to 32 characters")
      .optional(),
  })
  .catchall(z.unknown());
