/**
 * Whether `sql` holds exactly one statement.
 *
 * postgres.js sends a query without parameters over the simple protocol, which
 * runs every statement in it. A "read-only" query like
 * `select 1; commit; delete from t` then ends the read-only transaction and
 * writes. So the connector refuses anything with a `;` outside a string,
 * identifier, dollar-quoted body or comment.
 *
 * When in doubt the lexer sees a `;` as outside (a backslash ends nothing in a
 * standard string), so a misread can only refuse a query, never let one in.
 */
export function isSingleStatement(sql: string): boolean {
  if (sql.includes("\0")) return false;
  let i = 0;
  let sawEnd = false;
  const n = sql.length;
  while (i < n) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (c === "-" && next === "-") {
      const eol = sql.indexOf("\n", i);
      i = eol === -1 ? n : eol + 1;
      continue;
    }
    if (c === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") (depth++, (i += 2));
        else if (sql[i] === "*" && sql[i + 1] === "/") (depth--, (i += 2));
        else i++;
      }
      if (depth > 0) return false;
      continue;
    }
    if (sawEnd && !/\s/.test(c)) return false;
    if (c === ";") {
      sawEnd = true;
      i++;
      continue;
    }
    if (c === "'") {
      const escapes = i > 0 && /[eE]/.test(sql[i - 1]!) && !/[\w$]/.test(sql[i - 2] ?? "");
      i++;
      for (;;) {
        if (i >= n) return false;
        if (escapes && sql[i] === "\\") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '"') {
      i++;
      for (;;) {
        if (i >= n) return false;
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "$") {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag && !/[\w$]/.test(sql[i - 1] ?? "")) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        if (close === -1) return false;
        i = close + tag[0].length;
        continue;
      }
    }
    i++;
  }
  return true;
}
