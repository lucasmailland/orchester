import { z } from "zod";
import {
  FLOW_GROUP_ICONS,
  GROUP_DESCRIPTION_MAX,
  GROUP_MEMBERS_MAX,
  GROUP_NAME_MAX,
} from "./groups";

/**
 * What a caller sends to extract steps into their own flow: a group, or a
 * list of steps, plus the new flow's name, description and icon (a group's
 * own are used when absent). `preview` plans without writing anything.
 * Shared by the REST route and the MCP tool.
 */
export const extractRequestSchema = z
  .object({
    groupId: z.string().min(1).max(64).optional(),
    nodeIds: z.array(z.string().min(1).max(128)).min(1).max(GROUP_MEMBERS_MAX).optional(),
    name: z.string().trim().min(1).max(GROUP_NAME_MAX).optional(),
    description: z
      .string()
      .trim()
      .max(GROUP_DESCRIPTION_MAX)
      .refine((s) => !/[\r\n]/.test(s), "description must be one line")
      .optional(),
    icon: z.enum(FLOW_GROUP_ICONS).optional(),
    preview: z.boolean().optional(),
  })
  .strict()
  .refine((b) => (b.groupId === undefined) !== (b.nodeIds === undefined), {
    message: "send either groupId or nodeIds",
    path: ["groupId"],
  });

export type ExtractRequest = z.infer<typeof extractRequestSchema>;
