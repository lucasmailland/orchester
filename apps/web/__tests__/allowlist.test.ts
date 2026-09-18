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
