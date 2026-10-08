import { describe, it, expect } from "vitest";
import { CONNECTORS, actionEffect } from "@/lib/integrations/registry";

describe("connector action effects", () => {
  it("every registered action declares an effect", () => {
    const missing: string[] = [];
    for (const [cid, c] of Object.entries(CONNECTORS)) {
      for (const [key, a] of Object.entries(c.actions)) {
        const e = (a as { effect?: unknown }).effect;
        if (e !== "read" && e !== "write" && typeof e !== "function") missing.push(`${cid}.${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("a declaration that is missing counts as write", () => {
    expect(actionEffect(undefined, {})).toBe("write");
    expect(
      actionEffect(
        {
          description: "",
          inputSchema: { type: "object", properties: {} },
          run: async () => 1,
        } as never,
        {}
      )
    ).toBe("write");
  });

  it.each([
    ["odoo", "get_task"],
    ["odoo", "search_tasks"],
    ["odoo", "list_stages"],
    ["stripe", "list_customers"],
    ["notion", "query_database"],
    ["postgres", "query"],
    ["newrelic", "nrql"],
    ["gitlab", "read_file"],
  ])("%s.%s is read", (cid, key) => {
    expect(actionEffect(CONNECTORS[cid]!.actions[key], {})).toBe("read");
  });

  it.each([
    ["odoo", "create_ticket"],
    ["odoo", "update_ticket"],
    ["odoo", "post_note"],
    ["resend", "send_email"],
    ["slack", "post_message"],
    ["discord", "send_message"],
    ["discord", "send_embed"],
    ["telegram", "send_message"],
  ])("%s.%s is write", (cid, key) => {
    expect(actionEffect(CONNECTORS[cid]!.actions[key], {})).toBe("write");
  });

  describe("odoo.execute depends on the method", () => {
    const exec = CONNECTORS["odoo"]!.actions["execute"];
    it.each(["search_read", "read", "search_count", "fields_get", "name_search"])(
      "%s is read",
      (method) => expect(actionEffect(exec, { model: "project.task", method })).toBe("read")
    );
    it.each(["write", "create", "message_post", "unlink", "", "SEARCH_READ "])(
      "%j is write",
      (method) => expect(actionEffect(exec, { model: "project.task", method })).toBe("write")
    );
    it("a missing method is write", () => {
      expect(actionEffect(exec, { model: "project.task" })).toBe("write");
    });
  });

  describe("http.request depends on the method", () => {
    const req = CONNECTORS["http"]!.actions["request"];
    it("GET is read, POST is write, default is read", () => {
      expect(actionEffect(req, { path: "/", method: "GET" })).toBe("read");
      expect(actionEffect(req, { path: "/" })).toBe("read");
      expect(actionEffect(req, { path: "/", method: "post" })).toBe("write");
      expect(actionEffect(req, { path: "/", method: "DELETE" })).toBe("write");
    });
  });
});
