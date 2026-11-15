import type { Channel } from "@orchester/db";

export const SUPPORTED_CHANNEL_TYPES = ["web", "widget", "telegram", "api"] as const;
export type SupportedChannelType = (typeof SUPPORTED_CHANNEL_TYPES)[number];

export function isChannelSupported(type: Channel["type"]): boolean {
  return (SUPPORTED_CHANNEL_TYPES as readonly string[]).includes(type);
}
