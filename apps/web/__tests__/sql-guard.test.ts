import { describe, it, expect } from "vitest";
import { isSingleStatement } from "@/lib/integrations/sql-guard";

describe("isSingleStatement", () => {
  it.each([
    "select 1",
    "select 1;",
    "select 1;  \n -- trailing comment",
    "select ';' as semi",
    "select 'it''s; fine'",
    'select 1 as "a;b"',
    "select $$ ; $$",
    "select $body$ ; delete $body$",
    "select E'\\'; still a string'",
    "select 1 /* ; */ + 1",
    "select 1 /* nested /* ; */ */",
    "with x as (select 1) select * from x",
    "select $1::int",
  ])("accepts %s", (q) => {
    expect(isSingleStatement(q)).toBe(true);
  });

  it.each([
    "select 1; commit; delete from victim",
    "select 1; commit; do $$ begin execute 'DEL'||'ETE FROM victim'; end $$",
    "select 1;delete from t",
    // A backslash does not escape in a standard string: the quote ends it.
    "select 'a\\'; delete from t; --'",
    "select 'unterminated",
    'select "unterminated',
    "select $x$ never closed",
    "select 1 /* never closed",
    "select 1\0; delete from t",
  ])("refuses %s", (q) => {
    expect(isSingleStatement(q)).toBe(false);
  });
});
