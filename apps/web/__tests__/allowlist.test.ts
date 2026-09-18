import { expect, it } from "vitest";
import { isSenderAllowed } from "@/lib/channels/allowlist";

it.each([undefined, []].map((allowed) => ({ allowed })))(
  "opens absent/empty lists: %j",
  ({ allowed }) => {
    expect(isSenderAllowed(allowed, { id: "1234567" })).toBe(true);
  }
);
it.each(["1234567", "-1234567", "U_TEST", "C_TEST"])("matches exact ID %s", (id) => {
  expect(isSenderAllowed([id], { id })).toBe(true);
});
it.each(["@test_sender", "test_sender", "@TEST_SENDER", "TEST_SENDER"])(
  "matches username %s",
  (entry) => {
    expect(isSenderAllowed([entry], { id: "1234567", username: "Test_Sender" })).toBe(true);
    expect(isSenderAllowed([entry], { id: "1234567", username: "@Test_Sender" })).toBe(true);
  }
);
it("refuses nonmatching IDs and usernames", () => {
  expect(
    isSenderAllowed(["7654321", "@other_test"], { id: "1234567", username: "test_sender" })
  ).toBe(false);
  expect(isSenderAllowed(["test_sender"], { id: "1234567" })).toBe(false);
  expect(isSenderAllowed(["u_test"], { id: "U_TEST" })).toBe(false);
  expect(isSenderAllowed(["@1234567"], { id: "1234567" })).toBe(false);
});

it("never lets a username stand in for an ID-shaped entry", () => {
  // A Discord username may be digits only and is freely changeable, so without
  // this an attacker renames themselves to an allowlisted user's ID and walks
  // in. Telegram usernames cannot be numeric, so nothing is lost there.
  expect(
    isSenderAllowed(["402831774391369738"], {
      id: "999999999999999999",
      username: "402831774391369738",
    })
  ).toBe(false);
  // The real owner of that ID still gets in.
  expect(isSenderAllowed(["402831774391369738"], { id: "402831774391369738" })).toBe(true);
  // Negative Telegram group IDs are ID-shaped too.
  expect(isSenderAllowed(["-1001234567890"], { id: "42", username: "-1001234567890" })).toBe(false);
});

it("still matches a username that only looks a bit like a number", () => {
  // Four digits is a plausible nickname, not an account ID.
  expect(isSenderAllowed(["1984"], { id: "42", username: "1984" })).toBe(true);
});
