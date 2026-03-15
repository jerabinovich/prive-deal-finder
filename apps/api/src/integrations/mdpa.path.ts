import * as fs from "fs";
import * as path from "path";

const DEFAULT_MDPA_RELATIVE_PATH = path.join("data", "mdpa", "mdpa_bulk_latest.csv");
const DEFAULT_MDPA_CONTAINER_PATH = path.join("/app", "data", "mdpa", "mdpa_bulk_latest.csv");
const DEFAULT_MDPA_SEED_RELATIVE_PATH = path.join("apps", "api", "resources", "mdpa_bulk_seed.csv");
const DEFAULT_MDPA_SEED_CONTAINER_PATH = path.join("/app", "apps", "api", "resources", "mdpa_bulk_seed.csv");

export interface MdpaPathResolution {
  resolvedPath: string | null;
  checkedPaths: string[];
}

export function resolveMdpaBulkFilePath(configuredPath?: string): MdpaPathResolution {
  const candidates = [
    configuredPath?.trim(),
    process.env.MDPA_BULK_FILE_PATH?.trim(),
    path.resolve(process.cwd(), DEFAULT_MDPA_RELATIVE_PATH),
    DEFAULT_MDPA_CONTAINER_PATH,
    path.resolve(process.cwd(), DEFAULT_MDPA_SEED_RELATIVE_PATH),
    DEFAULT_MDPA_SEED_CONTAINER_PATH,
  ].filter(Boolean) as string[];

  const checkedPaths = Array.from(new Set(candidates));
  const resolvedPath = checkedPaths.find((candidate) => fs.existsSync(candidate)) ?? null;

  return { resolvedPath, checkedPaths };
}
