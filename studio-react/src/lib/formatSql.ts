/**
 * A small, conservative SQL pretty-printer for the query editor's Format action.
 *
 * It is deliberately minimal (no full SQL parser): it puts top-level clauses on
 * their own line and upper-cases a fixed keyword set. Crucially it is
 * quote/comment-aware — string literals, quoted identifiers and comments are
 * extracted first and never touched — so it won't corrupt data inside the query.
 * Good enough for the common `SELECT … FROM … WHERE …` shape; not a replacement
 * for a real formatter.
 */

/** Clauses that start a new line. Multi-word entries match across whitespace. */
const NEWLINE_BEFORE = [
  "from",
  "where",
  "group by",
  "order by",
  "having",
  "limit",
  "offset",
  "left join",
  "right join",
  "inner join",
  "outer join",
  "full join",
  "cross join",
  "join",
  "union all",
  "union",
  "values",
  "set",
  "returning",
];

/** Keywords upper-cased for consistency. */
const KEYWORDS = [
  "select", "from", "where", "group", "order", "by", "having", "limit", "offset",
  "and", "or", "not", "in", "is", "null", "like", "ilike", "between", "as", "on",
  "join", "left", "right", "inner", "outer", "full", "cross", "union", "all",
  "distinct", "insert", "into", "values", "update", "set", "delete", "asc", "desc",
  "returning", "case", "when", "then", "else", "end", "exists", "using",
];

const KEYWORD_RE = new RegExp(`\\b(${KEYWORDS.join("|")})\\b`, "gi");
const CLAUSE_RE = new RegExp(
  `\\s*\\b(${NEWLINE_BEFORE.map((c) => c.replace(/ /g, "\\s+")).join("|")})\\b`,
  "gi"
);

/** Transform a non-quoted, non-comment SQL fragment. */
function transformFragment(text: string): string {
  return text
    .replace(KEYWORD_RE, (m) => m.toUpperCase())
    .replace(CLAUSE_RE, (_m, kw: string) => `\n${kw.replace(/\s+/g, " ").toUpperCase()}`);
}

export function formatSql(sql: string): string {
  // Split out quoted strings, quoted identifiers and comments so they're left
  // verbatim; the odd-indexed parts are those protected chunks.
  const protectRe = /('(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|--[^\n]*|\/\*[\s\S]*?\*\/)/g;
  const parts = sql.split(protectRe);
  const rebuilt = parts
    .map((part, i) => (i % 2 === 1 ? part : transformFragment(part)))
    .join("");
  // Tidy whitespace: trim line ends, collapse blank runs, drop leading blank.
  return rebuilt
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .trim();
}
