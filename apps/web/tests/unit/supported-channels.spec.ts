import { it, expect } from "vitest";
import { SUPPORTED_CHANNEL_TYPES, isChannelSupported } from "@/lib/channels/supported";

it("supported set excludes the half-built channel types", () => {
  expect(isChannelSupported("widget")).toBe(true);
  expect(isChannelSupported("telegram")).toBe(true);
  expect(isChannelSupported("whatsapp")).toBe(false);
  expect(isChannelSupported("email")).toBe(false);
  expect(isChannelSupported("slack")).toBe(false);
  expect(SUPPORTED_CHANNEL_TYPES).not.toContain("whatsapp");
});
