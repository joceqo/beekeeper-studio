import {
  MCP_ACCESS_LEVELS,
  normalizeMcpAccess,
  resolveConnectAccess,
} from "@/backend/mcp/access";

describe("normalizeMcpAccess", () => {
  it.each(["none", "read", "write"] as const)("passes through valid level: %s", (level) => {
    expect(normalizeMcpAccess(level)).toBe(level);
  });

  it.each([undefined, null, "", "READ", "readonly", 0, {}, "hidden"])(
    "falls back to read for invalid value: %p",
    (value) => {
      expect(normalizeMcpAccess(value)).toBe("read");
    }
  );

  it("uses the provided fallback for invalid values", () => {
    expect(normalizeMcpAccess(undefined, "write")).toBe("write");
    expect(normalizeMcpAccess("garbage", "none")).toBe("none");
  });

  it("ignores the fallback when the value is valid", () => {
    expect(normalizeMcpAccess("read", "write")).toBe("read");
  });

  it("exposes the levels in UI order", () => {
    expect(MCP_ACCESS_LEVELS).toEqual(["none", "read", "write"]);
  });
});

describe("resolveConnectAccess", () => {
  it("refuses a hidden connection regardless of the requested level", () => {
    expect(resolveConnectAccess("none")).toMatchObject({ refused: true });
    expect(resolveConnectAccess("none", "read")).toMatchObject({ refused: true });
    expect(resolveConnectAccess("none", "write")).toMatchObject({ refused: true });
  });

  it("defaults to the saved level when no level is requested", () => {
    expect(resolveConnectAccess("read")).toEqual({ access: "read", refused: false });
    expect(resolveConnectAccess("write")).toEqual({ access: "write", refused: false });
  });

  it("allows narrowing the saved level (write connection opened read-only)", () => {
    expect(resolveConnectAccess("write", "read")).toEqual({ access: "read", refused: false });
  });

  it("refuses widening beyond the saved level (write on a read connection)", () => {
    const resolution = resolveConnectAccess("read", "write");
    expect(resolution.refused).toBe(true);
    expect(resolution.access).toBe("read");
    expect(resolution.reason).toMatch(/limited to 'read'/);
  });

  it("allows requesting exactly the saved level", () => {
    expect(resolveConnectAccess("read", "read")).toEqual({ access: "read", refused: false });
    expect(resolveConnectAccess("write", "write")).toEqual({ access: "write", refused: false });
  });

  it("gives a reason when refusing a hidden connection", () => {
    const resolution = resolveConnectAccess("none");
    expect(resolution.reason).toMatch(/hidden/i);
  });
});
