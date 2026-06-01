import { checkSqlAccess } from "@/backend/mcp/sqlGuard";

describe("checkSqlAccess", () => {
  describe("none access", () => {
    it("rejects everything, including SELECT", () => {
      expect(checkSqlAccess("SELECT 1", "none").allowed).toBe(false);
    });
  });

  describe("read access", () => {
    it.each([
      "SELECT * FROM users",
      "select id from users where id = 1",
      "WITH t AS (SELECT 1) SELECT * FROM t",
      "EXPLAIN SELECT * FROM users",
      "SHOW TABLES",
    ])("allows read-only statement: %s", (sql) => {
      expect(checkSqlAccess(sql, "read").allowed).toBe(true);
    });

    it.each([
      "INSERT INTO users (name) VALUES ('x')",
      "UPDATE users SET name = 'x'",
      "DELETE FROM users",
      "DROP TABLE users",
      "CREATE TABLE t (id int)",
      "ALTER TABLE users ADD COLUMN x int",
      "TRUNCATE users",
    ])("rejects mutating statement: %s", (sql) => {
      const res = checkSqlAccess(sql, "read");
      expect(res.allowed).toBe(false);
      expect(res.reason).toMatch(/read-only/i);
    });

    it("rejects a batch if any statement mutates (fail closed)", () => {
      const res = checkSqlAccess("SELECT 1; DELETE FROM users", "read");
      expect(res.allowed).toBe(false);
    });
  });

  describe("write access", () => {
    it.each([
      "SELECT * FROM users",
      "INSERT INTO users (name) VALUES ('x')",
      "DROP TABLE users",
      "UPDATE users SET name = 'x' WHERE id = 1",
    ])("allows any statement: %s", (sql) => {
      expect(checkSqlAccess(sql, "write").allowed).toBe(true);
    });
  });
});
