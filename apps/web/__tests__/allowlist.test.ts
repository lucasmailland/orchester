import { describe, expect, it } from "vitest";
import { isSenderAllowed } from "@/lib/channels/allowlist";

/** Shorthand: the gate takes the whole `channel.config`. */
const cfg = (c: Record<string, unknown> | null | undefined) => c;

describe("an unconfigured channel is closed", () => {
  // This is the behaviour that changed. It used to return true, and a Telegram
  // bot is addressable by its @name, so an active channel nobody had configured
  // answered anyone who found it.
  it.each([
    ["config absent", undefined],
    ["config null", null],
    ["config empty", {}],
    ["list absent", { commandName: "orchester" }],
    ["list empty", { allowedSenders: [] }],
  ])("refuses when %s", (_caso, config) => {
    expect(isSenderAllowed(cfg(config), { id: "1234567" })).toBe(false);
  });

  it("opens only when someone says so out loud", () => {
    expect(isSenderAllowed({ allowAnySender: true }, { id: "1234567" })).toBe(true);
    expect(isSenderAllowed({ allowedSenders: [], allowAnySender: true }, { id: "1" })).toBe(true);
  });

  it.each([
    ["false", false],
    ["the string true", "true"],
    ["1", 1],
    ["null", null],
  ])("does not accept %s as opening the channel", (_caso, valor) => {
    expect(isSenderAllowed({ allowAnySender: valor }, { id: "1234567" })).toBe(false);
  });

  it("ignores the flag once there is a list to check", () => {
    // An explicit list is the stricter statement of the two, so it wins.
    const config = { allowedSenders: ["7654321"], allowAnySender: true };
    expect(isSenderAllowed(config, { id: "7654321" })).toBe(true);
    expect(isSenderAllowed(config, { id: "1234567" })).toBe(false);
  });
});

describe("a malformed list denies, and the flag does not rescue it", () => {
  // `config` is a free-form jsonb column, so this is reachable without a code
  // change. Failing closed here is why the migration skips these channels:
  // flagging them would open something that was already shut.
  it.each([
    ["a string", "pablo"],
    ["a number", 42],
    ["an object", { "0": "pablo" }],
    ["true", true],
  ])("refuses when the list is %s", (_caso, allowedSenders) => {
    expect(isSenderAllowed({ allowedSenders }, { id: "1234567" })).toBe(false);
    expect(isSenderAllowed({ allowedSenders, allowAnySender: true }, { id: "1234567" })).toBe(
      false
    );
  });

  it("skips a non-string entry without letting it match", () => {
    expect(isSenderAllowed({ allowedSenders: [null, 1234567] }, { id: "1234567" })).toBe(false);
    // A good entry beside a bad one still works.
    expect(isSenderAllowed({ allowedSenders: [null, "1234567"] }, { id: "1234567" })).toBe(true);
  });
});

describe("matching, unchanged", () => {
  it.each(["1234567", "-1234567", "U_TEST", "C_TEST"])("matches exact ID %s", (id) => {
    expect(isSenderAllowed({ allowedSenders: [id] }, { id })).toBe(true);
  });

  it.each(["@test_sender", "test_sender", "@TEST_SENDER", "TEST_SENDER"])(
    "matches username %s",
    (entry) => {
      const config = { allowedSenders: [entry] };
      expect(isSenderAllowed(config, { id: "1234567", username: "Test_Sender" })).toBe(true);
      expect(isSenderAllowed(config, { id: "1234567", username: "@Test_Sender" })).toBe(true);
    }
  );

  it("refuses nonmatching IDs and usernames", () => {
    expect(
      isSenderAllowed(
        { allowedSenders: ["7654321", "@other_test"] },
        { id: "1234567", username: "test_sender" }
      )
    ).toBe(false);
    expect(isSenderAllowed({ allowedSenders: ["test_sender"] }, { id: "1234567" })).toBe(false);
    expect(isSenderAllowed({ allowedSenders: ["u_test"] }, { id: "U_TEST" })).toBe(false);
    expect(isSenderAllowed({ allowedSenders: ["@1234567"] }, { id: "1234567" })).toBe(false);
  });

  it("never lets a username stand in for an ID-shaped entry", () => {
    // A Discord username may be digits only and is freely changeable, so without
    // this an attacker renames themselves to an allowlisted user's ID and walks
    // in. Telegram usernames cannot be numeric, so nothing is lost there.
    expect(
      isSenderAllowed(
        { allowedSenders: ["402831774391369738"] },
        { id: "999999999999999999", username: "402831774391369738" }
      )
    ).toBe(false);
    // The real owner of that ID still gets in.
    expect(
      isSenderAllowed({ allowedSenders: ["402831774391369738"] }, { id: "402831774391369738" })
    ).toBe(true);
    // Negative Telegram group IDs are ID-shaped too.
    expect(
      isSenderAllowed(
        { allowedSenders: ["-1001234567890"] },
        { id: "42", username: "-1001234567890" }
      )
    ).toBe(false);
  });

  it("still matches a username that only looks a bit like a number", () => {
    // Four digits is a plausible nickname, not an account ID.
    expect(isSenderAllowed({ allowedSenders: ["1984"] }, { id: "42", username: "1984" })).toBe(
      true
    );
  });
});
