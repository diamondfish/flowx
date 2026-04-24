#!/usr/bin/env node
import { confirm, select } from "@inquirer/prompts";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadConfig,
  writeConfigTemplate,
  buildConfigContent,
  configExists,
  CONFIG_FILENAME,
} from "../src/config.js";
import { C } from "../src/colors.js";
import { buildProtectedMatcher } from "../src/protected.js";
import {
  isInsideGitRepo,
  hasRemote,
  getCurrentBranch,
  createRemoteClient,
} from "../src/git.js";
import { branchCheckbox } from "../src/prompts.js";

const hasFlag = (flag) =>
  process.argv.some((a) => a === flag || a.startsWith(`${flag}=`));

const getFlagValue = (flag) => {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1) {
    const next = process.argv[idx + 1];
    if (next && !next.startsWith("-")) return next;
  }
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  return null;
};

const CONFIG_PATH = getFlagValue("--config") ?? getFlagValue("-c");
const WRITE_CONFIG_MODE = hasFlag("--write-config") || hasFlag("-w");
const WRITE_CONFIG_PATH = getFlagValue("--write-config") ?? getFlagValue("-w");
const DRY_RUN = process.argv.includes("--dry-run");

let REMOTE = "origin";
let PROTECTED = buildProtectedMatcher([]);
let BASE = null;
let CONFIG_EXISTS = false;
if (!WRITE_CONFIG_MODE) {
  try {
    const config = loadConfig(CONFIG_PATH);
    REMOTE = config.remote;
    PROTECTED = buildProtectedMatcher(config.protected);
    BASE = config.base;
  } catch (err) {
    console.error(`${C.red}${err.message}${C.reset}`);
    process.exit(1);
  }
  CONFIG_EXISTS = configExists(CONFIG_PATH);
  if (BASE) PROTECTED.add(BASE);
}

const remote = createRemoteClient(REMOTE);

const isProtected = (branch, currentBranch) =>
  PROTECTED.has(branch) || branch === currentBranch;

const runInit = async (branches) => {
  const names = branches
    .map((b) => b.name)
    .sort((a, b) => {
      const aSlash = a.includes("/");
      const bSlash = b.includes("/");
      if (aSlash !== bSlash) return aSlash ? 1 : -1;
      return a.localeCompare(b);
    });
  const repoDefault = remote.getDefaultBranch();
  const preferred =
    (repoDefault && names.includes(repoDefault) ? repoDefault : null) ??
    names.find((n) => n === "develop") ??
    names.find((n) => n === "development") ??
    names[0];

  console.log("");
  console.log(
    `${C.cyan}No ${CONFIG_FILENAME} found — let's configure flowx for this repo.${C.reset}`,
  );
  console.log(
    `${C.dim}Pick the branch that others typically fork from. Used for the "Ahead" column.${C.reset}`,
  );
  console.log("");

  const picked = await select({
    message: "Base branch:",
    default: preferred,
    choices: [
      ...names.map((n) => ({ name: n, value: n })),
      { name: "— no base (hide Ahead column)", value: null },
    ],
  });

  const targetPath = resolve(CONFIG_FILENAME);
  writeFileSync(targetPath, buildConfigContent({ base: picked }), "utf8");
  console.log(`${C.green}Wrote${C.reset} ${targetPath}\n`);

  return picked;
};

const runWriteConfig = async (targetPath) => {
  const path = resolve(targetPath ?? CONFIG_FILENAME);
  if (existsSync(path)) {
    const overwrite = await confirm({
      message: `${path} already exists. Overwrite?`,
      default: false,
    });
    if (!overwrite) {
      console.log(`${C.dim}Aborted. File was not changed.${C.reset}`);
      return;
    }
  }
  writeConfigTemplate(path);
  console.log(`${C.green}Wrote${C.reset} ${path}`);
};

const deleteBranchWithDryRun = (branch) => {
  if (DRY_RUN) {
    console.log(
      `${C.yellow}[dry-run]${C.reset} would delete ${C.bold}${branch}${C.reset}`,
    );
    return { ok: true };
  }
  return remote.deleteBranch(branch);
};

const main = async () => {
  if (WRITE_CONFIG_MODE) {
    await runWriteConfig(WRITE_CONFIG_PATH);
    return;
  }

  if (!isInsideGitRepo()) {
    console.error(
      `${C.red}Not a git repository.${C.reset} ${C.dim}Run flowx from inside a git repo.${C.reset}`,
    );
    process.exit(1);
  }

  if (!hasRemote(REMOTE)) {
    console.error(
      `${C.red}Remote '${REMOTE}' not found.${C.reset} ${C.dim}Add it with:${C.reset} git remote add ${REMOTE} <url>`,
    );
    process.exit(1);
  }

  const currentBranch = getCurrentBranch();

  process.stdout.write(`${C.cyan}Fetching from ${REMOTE}...${C.reset}`);
  remote.fetchPrune();
  process.stdout.write(` ${C.green}done${C.reset}\n`);
  const branches = remote.listBranches();

  if (branches.length === 0) {
    console.log(`${C.yellow}No remote branches found on ${REMOTE}.${C.reset}`);
    process.exit(0);
  }

  if (BASE && !branches.some((b) => b.name === BASE)) {
    console.log(
      `${C.yellow}⚠ Configured base "${BASE}" not found on ${REMOTE} — hiding Ahead column.${C.reset}`,
    );
    PROTECTED.delete(BASE);
    BASE = null;
  }

  if (!CONFIG_EXISTS) {
    BASE = await runInit(branches);
    if (BASE) PROTECTED.add(BASE);
  }

  const repoDefault = remote.getDefaultBranch();
  if (repoDefault) PROTECTED.add(repoDefault);

  const branchReason = (name) => {
    const isDefault = name === repoDefault;
    const isBase = name === BASE;
    if (isDefault && isBase) return "default/base";
    if (isDefault) return "default";
    if (isBase) return "base";
    if (name === currentBranch) return "current HEAD";
    if (PROTECTED.has(name)) return "protected";
    return false;
  };

  process.stdout.write(`${C.cyan}Counting commits...${C.reset}`);
  for (const b of branches) {
    b.commits = remote.getCommitCount(b.name);
    if (BASE) b.ahead = remote.getCommitsAhead(b.name, BASE);
  }
  process.stdout.write(` ${C.green}done${C.reset}\n`);

  const deletableCount = branches.filter(
    (b) => !isProtected(b.name, currentBranch),
  ).length;

  if (deletableCount === 0) {
    const rows = branches.map((b) => {
      const reason = branchReason(b.name) || "protected";
      return { ...b, reason, display: `${b.name} (${reason})` };
    });
    const updatedCol = (r) =>
      r.relative ? `${r.date} (${r.relative})` : r.date;
    const maxDisplayLen = rows.reduce(
      (m, r) => Math.max(m, r.display.length),
      0,
    );
    const maxUpdatedLen = rows.reduce(
      (m, r) => Math.max(m, updatedCol(r).length),
      "Updated".length,
    );
    const headerCols = [
      "Branch".padEnd(maxDisplayLen),
      "Updated".padEnd(maxUpdatedLen),
      "Commits".padEnd(7),
    ];
    if (BASE) headerCols.push("Ahead".padEnd(5));
    console.log("");
    console.log(`${C.dim}      ${headerCols.join("  ")}${C.reset}`);
    for (const r of rows) {
      const padded = r.display.padEnd(maxDisplayLen);
      const commits = r.commits == null ? "?" : String(r.commits);
      const parts = [
        padded,
        updatedCol(r).padEnd(maxUpdatedLen),
        commits.padEnd(7),
      ];
      if (BASE) {
        const ahead = r.ahead == null ? "—" : String(r.ahead);
        parts.push(ahead.padEnd(5));
      }
      console.log(`  ${C.dim}[-] ${parts.join("  ")}${C.reset}`);
    }
    console.log("");
    console.log(
      `${C.yellow}Only protected branches exist on ${REMOTE}. Nothing to delete.${C.reset}`,
    );
    process.exit(0);
  }

  if (DRY_RUN) {
    console.log(
      `${C.yellow}${C.bold}[DRY-RUN MODE]${C.reset} ${C.yellow}no branches will actually be deleted${C.reset}\n`,
    );
  }

  const choices = branches.map((b) => {
    const disabled = isProtected(b.name, currentBranch);
    const reason = branchReason(b.name);
    return {
      name: b.name,
      value: b.name,
      date: b.date,
      relative: b.relative,
      commits: b.commits,
      ahead: b.ahead,
      disabled: disabled ? reason : false,
    };
  });

  const selected = await branchCheckbox({
    message: `Select branches to delete from ${REMOTE}`,
    choices,
    showAhead: BASE !== null,
  });

  if (selected.length === 0) {
    console.log(`${C.dim}No branches selected. Exiting.${C.reset}`);
    process.exit(0);
  }

  console.log(`\n${C.bold}Branches to delete:${C.reset}`);
  for (const b of selected) console.log(`  - ${b}`);
  console.log("");

  const ok = await confirm({
    message: `Delete ${selected.length} branch${selected.length === 1 ? "" : "es"} from ${REMOTE}? This cannot be undone.`,
    default: false,
  });

  if (!ok) {
    console.log(`${C.dim}Aborted. No branches were deleted.${C.reset}`);
    process.exit(0);
  }

  console.log("");
  const results = [];
  for (const branch of selected) {
    process.stdout.write(`Deleting ${branch}... `);
    const result = deleteBranchWithDryRun(branch);
    if (result.ok) {
      console.log(`${C.green}✔${C.reset}`);
    } else {
      console.log(`${C.red}✖${C.reset}`);
      console.log(
        `  ${C.red}${result.error.trim().split("\n").join("\n  ")}${C.reset}`,
      );
    }
    results.push({ branch, ...result });
  }

  const failures = results.filter((r) => !r.ok);
  console.log("");
  console.log(
    `${C.bold}Done.${C.reset} ${C.green}${results.length - failures.length} deleted${C.reset}` +
      (failures.length ? `, ${C.red}${failures.length} failed${C.reset}` : ""),
  );
  process.exit(failures.length ? 1 : 0);
};

main().catch((err) => {
  if (err && err.name === "ExitPromptError") {
    console.log(`\n${C.dim}Cancelled.${C.reset}`);
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});
