import { z } from "zod";

export const channelConfigSchema = z
  .object({
    allowedSenders: z.array(z.string().trim().min(1).max(256)).max(200).optional(),
  })
  .catchall(z.unknown());
