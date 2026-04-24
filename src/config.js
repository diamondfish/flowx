import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_FILENAME = ".flowx.jsonc";

const DEFAULTS = {
  remote: "origin",
  base: null,
  protected: [
    "master",
    "main",
    "develop",
    "development",
    "prod",
    "production",
    "staging",
  ],
};

export const buildConfigContent = ({ base } = {}) => {
  const baseLine = base ? `  "base": "${base}",` : `  "base": null,`;
  const protectedBlock = [
    `  // "protected": [`,
    ...DEFAULTS.protected.map((b) => `  //   "${b}",`),
    `  // ]`,
  ].join("\n");

  return `{
  // Remote to operate on
  "remote": "${DEFAULTS.remote}",

  // Branch used as the base for the "Ahead" column.
  // Set to null to hide the Ahead column.
${baseLine}

  // Branches that cannot be deleted — uncomment and edit to override defaults.
${protectedBlock}
}
`;
};

export const CONFIG_TEMPLATE = buildConfigContent();

const stripTrailingCommas = (source) => source.replace(/,(\s*[\]}])/g, "$1");

const stripComments = (source) => {
  let out = "";
  let i = 0;
  const len = source.length;
  while (i < len) {
    const c = source[i];
    const n = source[i + 1];

    if (c === '"') {
      out += c;
      i += 1;
      while (i < len) {
        const cc = source[i];
        out += cc;
        if (cc === "\\" && i + 1 < len) {
          out += source[i + 1];
          i += 2;
          continue;
        }
        i += 1;
        if (cc === '"') break;
      }
      continue;
    }

    if (c === "/" && n === "/") {
      while (i < len && source[i] !== "\n") i += 1;
      continue;
    }

    if (c === "/" && n === "*") {
      i += 2;
      while (i < len && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }

    out += c;
    i += 1;
  }
  return out;
};

export const configExists = (configPath) => {
  const path = configPath ?? join(process.cwd(), CONFIG_FILENAME);
  return existsSync(path);
};

export const loadConfig = (configPath) => {
  const explicit = configPath != null;
  const path = explicit ? configPath : join(process.cwd(), CONFIG_FILENAME);

  if (!existsSync(path)) {
    if (explicit) throw new Error(`Config file not found: ${path}`);
    return { ...DEFAULTS };
  }

  const raw = readFileSync(path, "utf8");

  let parsed;
  try {
    parsed = JSON.parse(stripTrailingCommas(stripComments(raw)));
  } catch (err) {
    throw new Error(`Failed to parse ${path}: ${err.message}`);
  }

  const config = { ...DEFAULTS };
  if (typeof parsed.remote === "string" && parsed.remote.trim()) {
    config.remote = parsed.remote.trim();
  }
  if (typeof parsed.base === "string" && parsed.base.trim()) {
    config.base = parsed.base.trim();
  }
  if (Array.isArray(parsed.protected)) {
    config.protected = parsed.protected.filter((b) => typeof b === "string");
  }
  return config;
};

export const writeConfigTemplate = (targetPath) => {
  writeFileSync(targetPath, CONFIG_TEMPLATE, "utf8");
};
