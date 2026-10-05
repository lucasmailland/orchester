import { describe, expect, it } from "vitest";
import { allowsPassiveMemoryRecall } from "@/lib/channels/public-channels";

// `widget` and `web` channels serve anonymous visitors, so workspace memory
// is not injected into their prompt.
describe("allowsPassiveMemoryRecall", () => {
  it.each(["widget", "web"])("is off for the public %s channel", (type) => {
    expect(allowsPassiveMemoryRecall(type)).toBe(false);
  });

  it.each(["slack", "telegram", "discord", "whatsapp", "email", "api"])(
    "stays on for the %s channel",
    (type) => {
      expect(allowsPassiveMemoryRecall(type)).toBe(true);
    }
  );
});
