import { describe, expect, it } from "vitest";
import { lugarPermitido } from "@/lib/channels/lugar";

const GUILD = "402831774391369738";
const CANAL = "999999999999999999";
const OTRO = "111111111111111111";

describe("without configuration nothing is restricted", () => {
  // The asymmetry with `allowedSenders` — where empty denies — is deliberate:
  // the sender gate has already decided who, and defaulting this to deny would
  // break every Discord channel that works today.
  it.each([
    ["config absent", undefined],
    ["config null", null],
    ["config empty", {}],
    ["only unrelated keys", { commandName: "orchester" }],
    ["empty lists", { allowedGuilds: [], allowedChannels: [] }],
  ])("lets the command through when %s", (_caso, config) => {
    expect(lugarPermitido(config, { guildId: GUILD, channelId: CANAL })).toBe("ok");
  });

  it("lets a direct message through, which has no guild at all", () => {
    expect(lugarPermitido({}, { guildId: undefined, channelId: CANAL })).toBe("ok");
  });
});

describe("a configured list restricts", () => {
  it("accepts a listed server and channel", () => {
    const config = { allowedGuilds: [GUILD], allowedChannels: [CANAL] };
    expect(lugarPermitido(config, { guildId: GUILD, channelId: CANAL })).toBe("ok");
  });

  it("names WHICH dimension refused, so the message can say what to do", () => {
    // A boolean would force the caller to write "not allowed" for both, and the
    // person would not know whether to add a server or a channel.
    expect(lugarPermitido({ allowedGuilds: [GUILD] }, { guildId: OTRO, channelId: CANAL })).toBe(
      "guild-no-permitido"
    );
    expect(lugarPermitido({ allowedChannels: [CANAL] }, { guildId: GUILD, channelId: OTRO })).toBe(
      "canal-no-permitido"
    );
  });

  it("checks the server before the channel", () => {
    // Both wrong: the server is the broader fact and the more useful thing to
    // report first.
    const config = { allowedGuilds: [GUILD], allowedChannels: [CANAL] };
    expect(lugarPermitido(config, { guildId: OTRO, channelId: OTRO })).toBe("guild-no-permitido");
  });

  it("refuses a direct message once servers are restricted", () => {
    // This is the case worth pinning: a DM carries no guild_id, so "the list
    // does not contain undefined" has to mean refusal and not a pass.
    expect(
      lugarPermitido({ allowedGuilds: [GUILD] }, { guildId: undefined, channelId: CANAL })
    ).toBe("guild-no-permitido");
  });
});

describe("a malformed list fails closed", () => {
  // `config` is a free-form jsonb column, so this is reachable without a code
  // change — the same reason the sender gate fails closed.
  it.each([
    ["a string", "402831774391369738"],
    // Under 2^53 on purpose: a bigger literal silently loses precision,
    // so the test would feed a different number than it claims to.
    ["a number", 402831774391],
    ["an object", { "0": GUILD }],
    ["true", true],
  ])("refuses when allowedGuilds is %s", (_caso, allowedGuilds) => {
    expect(lugarPermitido({ allowedGuilds }, { guildId: GUILD, channelId: CANAL })).toBe(
      "guild-no-permitido"
    );
  });

  it("ignores a non-string entry without letting it match", () => {
    expect(lugarPermitido({ allowedGuilds: [null, 402831774391] }, { guildId: GUILD })).toBe(
      "guild-no-permitido"
    );
    // A good entry beside a bad one still works.
    expect(lugarPermitido({ allowedGuilds: [null, GUILD] }, { guildId: GUILD })).toBe("ok");
  });

  it("does not accept an entry that is not snowflake-shaped", () => {
    // Guards against someone writing a server *name* in the list and believing
    // it is enforced.
    expect(lugarPermitido({ allowedGuilds: ["mi-servidor"] }, { guildId: "mi-servidor" })).toBe(
      "guild-no-permitido"
    );
  });
});
