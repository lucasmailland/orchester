import { describe, expect, it } from "vitest";
import { checkCommandPlace } from "@/lib/channels/place";

const GUILD = "402831774391369738";
const CHANNEL = "999999999999999999";
const OTHER = "111111111111111111";

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
  ])("lets the command through when %s", (_case, config) => {
    expect(checkCommandPlace(config, { guildId: GUILD, channelId: CHANNEL })).toBe("ok");
  });

  it("lets a direct message through, which has no guild at all", () => {
    expect(checkCommandPlace({}, { guildId: undefined, channelId: CHANNEL })).toBe("ok");
  });
});

describe("a configured list restricts", () => {
  it("accepts a listed server and channel", () => {
    const config = { allowedGuilds: [GUILD], allowedChannels: [CHANNEL] };
    expect(checkCommandPlace(config, { guildId: GUILD, channelId: CHANNEL })).toBe("ok");
  });

  it("names WHICH dimension refused, so the message can say what to do", () => {
    // A boolean would force the caller to write "not allowed" for both, and the
    // person would not know whether to add a server or a channel.
    expect(
      checkCommandPlace({ allowedGuilds: [GUILD] }, { guildId: OTHER, channelId: CHANNEL })
    ).toBe("guild-not-allowed");
    expect(
      checkCommandPlace({ allowedChannels: [CHANNEL] }, { guildId: GUILD, channelId: OTHER })
    ).toBe("channel-not-allowed");
  });

  it("checks the server before the channel", () => {
    // Both wrong: the server is the broader fact and the more useful thing to
    // report first.
    const config = { allowedGuilds: [GUILD], allowedChannels: [CHANNEL] };
    expect(checkCommandPlace(config, { guildId: OTHER, channelId: OTHER })).toBe(
      "guild-not-allowed"
    );
  });

  it("refuses a direct message once servers are restricted", () => {
    // This is the case worth pinning: a DM carries no guild_id, so "the list
    // does not contain undefined" has to mean refusal and not a pass.
    expect(
      checkCommandPlace({ allowedGuilds: [GUILD] }, { guildId: undefined, channelId: CHANNEL })
    ).toBe("guild-not-allowed");
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
  ])("refuses when allowedGuilds is %s", (_case, allowedGuilds) => {
    expect(checkCommandPlace({ allowedGuilds }, { guildId: GUILD, channelId: CHANNEL })).toBe(
      "guild-not-allowed"
    );
  });

  it("ignores a non-string entry without letting it match", () => {
    expect(checkCommandPlace({ allowedGuilds: [null, 402831774391] }, { guildId: GUILD })).toBe(
      "guild-not-allowed"
    );
    // A good entry beside a bad one still works.
    expect(checkCommandPlace({ allowedGuilds: [null, GUILD] }, { guildId: GUILD })).toBe("ok");
  });

  it("does not accept an entry that is not snowflake-shaped", () => {
    // Guards against someone writing a server *name* in the list and believing
    // it is enforced.
    expect(
      checkCommandPlace({ allowedGuilds: ["example-server"] }, { guildId: "example-server" })
    ).toBe("guild-not-allowed");
  });
});

describe("a thread inside an allowed channel gets in", () => {
  // This is the case the whole feature hangs on: an incident is posted to
  // an alerts channel and a thread is opened on it to talk to the agent. A thread is
  // a channel with its own id, so without this an allowlist of that channel
  // would refuse every single one of those conversations — the filter working
  // exactly backwards from what it is for.
  const THREAD = "777777777777777777";

  it("accepts the thread when its parent is the allowed channel", () => {
    expect(
      checkCommandPlace({ allowedChannels: [CHANNEL] }, { channelId: THREAD, parentId: CHANNEL })
    ).toBe("ok");
  });

  it("accepts it the other way round too, because the docs do not say which id arrives", () => {
    // Discord documents that the partial channel object carries `parent_id`,
    // but not whether an interaction's `channel_id` is the thread or the
    // parent. Checking both means the answer does not matter.
    expect(
      checkCommandPlace({ allowedChannels: [CHANNEL] }, { channelId: CHANNEL, parentId: CHANNEL })
    ).toBe("ok");
  });

  it("still refuses a thread whose parent is NOT allowed", () => {
    expect(
      checkCommandPlace({ allowedChannels: [CHANNEL] }, { channelId: THREAD, parentId: OTHER })
    ).toBe("channel-not-allowed");
  });

  it("accepts a thread listed on its own, without its parent", () => {
    expect(
      checkCommandPlace({ allowedChannels: [THREAD] }, { channelId: THREAD, parentId: OTHER })
    ).toBe("ok");
  });

  it("a malformed list still fails closed, parent or no parent", () => {
    expect(
      checkCommandPlace(
        { allowedChannels: "no-soy-una-lista" },
        { channelId: THREAD, parentId: CHANNEL }
      )
    ).toBe("channel-not-allowed");
  });

  it("the guild check runs first, parent or no parent", () => {
    expect(
      checkCommandPlace(
        { allowedGuilds: [GUILD], allowedChannels: [CHANNEL] },
        { guildId: OTHER, channelId: THREAD, parentId: CHANNEL }
      )
    ).toBe("guild-not-allowed");
  });
});
