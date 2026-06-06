import rawLog from "@bksLogger";
import { execFile } from "child_process";

const log = rawLog.scope("DockerHandlers");

/**
 * A running Docker container that hosts a database, surfaced in the sidebar for
 * one-click connect (mirrors SlashTable's Docker auto-detect). Detection is
 * best-effort: when the `docker` CLI is missing or the daemon is down, the
 * handler resolves to an empty list rather than erroring.
 */
export interface DockerDbContainer {
  /** Full container id. */
  id: string;
  /** Primary container name (leading slash stripped). */
  name: string;
  /** Image reference, e.g. "postgres:16". */
  image: string;
  /** The database engine inferred from the image. */
  driver: "postgres" | "mysql" | "mariadb" | "sqlserver";
  /** Host the container is reachable on (always localhost for published ports). */
  host: string;
  /** Published host port, or the engine default when none could be parsed. */
  port: number | null;
  /** Raw `docker ps` status string, e.g. "Up 3 hours". */
  status: string;
  /** Whether the status indicates a running container. */
  running: boolean;
}

export interface IDockerHandlers {
  "docker/listContainers": () => Promise<DockerDbContainer[]>;
}

/** The subset of `docker ps --format '{{json .}}'` fields consumed here. */
interface DockerPsLine {
  ID?: string;
  Names?: string;
  Image?: string;
  Ports?: string;
  Status?: string;
  State?: string;
}

/** Image-name patterns → engine + default port. Order matters (mariadb before mysql). */
const IMAGE_DRIVERS: { match: RegExp; driver: DockerDbContainer["driver"]; port: number }[] = [
  { match: /(postgres|postgis|timescale|pgvector)/i, driver: "postgres", port: 5432 },
  { match: /mariadb/i, driver: "mariadb", port: 3306 },
  { match: /(mysql|percona)/i, driver: "mysql", port: 3306 },
  { match: /(mssql|sqlserver|azure-sql)/i, driver: "sqlserver", port: 1433 },
];

function driverForImage(image: string): { driver: DockerDbContainer["driver"]; port: number } | null {
  for (const { match, driver, port } of IMAGE_DRIVERS) {
    if (match.test(image)) return { driver, port };
  }
  return null;
}

/**
 * Parse the published host port from a `docker ps` Ports string such as
 * "0.0.0.0:5432->5432/tcp, :::5432->5432/tcp". Prefers the mapping whose
 * container port matches the engine's default; otherwise the first published
 * port. Returns null when nothing is published (the container isn't reachable
 * from the host).
 */
function parsePublishedPort(ports: string, defaultContainerPort: number): number | null {
  const mappings = [...ports.matchAll(/:(\d+)->(\d+)\/(?:tcp|udp)/g)].map((m) => ({
    host: Number(m[1]),
    container: Number(m[2]),
  }));
  if (!mappings.length) return null;
  const preferred = mappings.find((m) => m.container === defaultContainerPort);
  return (preferred ?? mappings[0]).host;
}

/** Run `docker ps` and return its stdout, or null when docker is unavailable. */
function runDockerPs(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "docker",
      ["ps", "--no-trunc", "--format", "{{json .}}"],
      { timeout: 4000, windowsHide: true },
      (err, stdout) => {
        if (err) {
          // ENOENT (no docker binary) or daemon down — degrade to "no containers".
          log.debug("docker ps unavailable:", err.message);
          resolve(null);
          return;
        }
        resolve(stdout);
      }
    );
  });
}

export const DockerHandlers: IDockerHandlers = {
  "docker/listContainers": async function (): Promise<DockerDbContainer[]> {
    const stdout = await runDockerPs();
    if (!stdout) return [];

    const containers: DockerDbContainer[] = [];
    for (const rawLine of stdout.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      let parsed: DockerPsLine;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const image = parsed.Image ?? "";
      const match = driverForImage(image);
      if (!match) continue;

      const port = parsePublishedPort(parsed.Ports ?? "", match.port) ?? match.port;
      const status = parsed.Status ?? "";
      containers.push({
        id: parsed.ID ?? "",
        // `docker ps` joins multiple names with commas; take the first.
        name: (parsed.Names ?? "").split(",")[0].replace(/^\//, "") || image,
        image,
        driver: match.driver,
        host: "localhost",
        port,
        status,
        running: (parsed.State ?? "").toLowerCase() === "running" || /^up\b/i.test(status),
      });
    }
    return containers;
  },
};
