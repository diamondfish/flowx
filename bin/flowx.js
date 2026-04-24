#!/usr/bin/env node
import { execSync } from "node:child_process";
import { confirm, select } from "@inquirer/prompts";
import {
  createPrompt,
  useState,
  useKeypress,
  usePrefix,
  isEnterKey,
  isSpaceKey,
  isUpKey,
  isDownKey,
  makeTheme,
} from "@inquirer/core";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadConfig,
  writeConfigTemplate,
  buildConfigContent,
  configExists,
  CONFIG_FILENAME,
} from "../src/config.js";

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

const buildProtectedMatcher = (patterns) => {
  const exact = new Set();
  const regexes = [];
  for (const p of patterns) {
    if (typeof p !== "string" || !p) continue;
    if (p.includes("*")) {
      const escape = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      const source = "^" + p.split("*").map(escape).join(".*") + "$";
      regexes.push(new RegExp(source));
    } else {
      exact.add(p);
    }
  }
  return {
    has: (name) => exact.has(name) || regexes.some((re) => re.test(name)),
    add: (name) => exact.add(name),
    delete: (name) => exact.delete(name),
  };
};

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
    console.error(`\x1b[31m${err.message}\x1b[0m`);
    process.exit(1);
  }
  CONFIG_EXISTS = configExists(CONFIG_PATH);
  if (BASE) PROTECTED.add(BASE);
}

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[90m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

const git = (args) => execSync(`git ${args}`, { encoding: "utf8" }).trim();

const isInsideGitRepo = () => {
  try {
    execSync("git rev-parse --is-inside-work-tree", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};

const hasRemote = (name) => {
  try {
    execSync(`git remote get-url ${name}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};

const getCurrentBranch = () => {
  try {
    return git("rev-parse --abbrev-ref HEAD");
  } catch {
    return null;
  }
};

const fetchAndListRemoteBranches = () => {
  process.stdout.write(`${C.cyan}Fetching from ${REMOTE}...${C.reset}`);
  execSync(`git fetch --prune ${REMOTE}`, { stdio: "pipe" });
  process.stdout.write(` ${C.green}done${C.reset}\n`);
  const raw = git(
    `for-each-ref --format=%(refname)%09%(committerdate:short) refs/remotes/${REMOTE}`,
  );
  const prefix = `refs/remotes/${REMOTE}/`;
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const [refname, date] = line.split("\t");
      return { refname, date };
    })
    .filter((r) => r.refname.startsWith(prefix))
    .map((r) => ({ name: r.refname.slice(prefix.length), date: r.date }))
    .filter((b) => b.name !== "HEAD")
    .sort((a, b) => a.name.localeCompare(b.name));
};

const getRepoDefaultBranch = () => {
  try {
    const ref = git(`symbolic-ref --short refs/remotes/${REMOTE}/HEAD`);
    const prefix = `${REMOTE}/`;
    if (ref.startsWith(prefix)) return ref.slice(prefix.length);
  } catch {
    // origin/HEAD not set
  }
  return null;
};

const runInit = async (branches) => {
  const names = branches
    .map((b) => b.name)
    .sort((a, b) => {
      const aSlash = a.includes("/");
      const bSlash = b.includes("/");
      if (aSlash !== bSlash) return aSlash ? 1 : -1;
      return a.localeCompare(b);
    });
  const repoDefault = getRepoDefaultBranch();
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

const getCommitCount = (branch) => {
  try {
    return Number(git(`rev-list --count refs/remotes/${REMOTE}/${branch}`));
  } catch {
    return null;
  }
};

const getCommitsAhead = (branch, base) => {
  if (!base) return null;
  try {
    return Number(
      git(
        `rev-list --count refs/remotes/${REMOTE}/${base}..refs/remotes/${REMOTE}/${branch}`,
      ),
    );
  } catch {
    return null;
  }
};

const isProtected = (branch, currentBranch) =>
  PROTECTED.has(branch) || branch === currentBranch;

const DELETE_ROW = Symbol("delete-row");
const isRightKey = (key) => key && key.name === "right";

const displayName = (item) => {
  if (!item.disabled) return item.name;
  const reason =
    typeof item.disabled === "string" ? item.disabled : "protected";
  return `${item.name} (${reason})`;
};

const branchCheckbox = createPrompt((config, done) => {
  const { message, choices } = config;
  const theme = makeTheme();
  const prefix = usePrefix({ theme });

  const items = [...choices, DELETE_ROW];
  const maxDisplayLen = choices.reduce(
    (m, c) => Math.max(m, displayName(c).length),
    0,
  );
  const firstSelectable = choices.findIndex((c) => !c.disabled);
  const initialCursor =
    firstSelectable >= 0 ? firstSelectable : items.length - 1;

  const [cursor, setCursor] = useState(initialCursor);
  const [selected, setSelected] = useState(new Set());
  const [submitted, setSubmitted] = useState(false);

  const submit = () => {
    const chosen = choices
      .filter((c) => selected.has(c.value))
      .map((c) => c.value);
    setSubmitted(true);
    done(chosen);
  };

  useKeypress((key) => {
    if (submitted) return;

    if (isEnterKey(key)) {
      submit();
      return;
    }

    if (isUpKey(key) || isDownKey(key)) {
      const dir = isUpKey(key) ? -1 : 1;
      let next = cursor;
      for (let i = 0; i < items.length; i += 1) {
        next = (next + dir + items.length) % items.length;
        const it = items[next];
        if (it === DELETE_ROW) break;
        if (!it.disabled) break;
      }
      setCursor(next);
      return;
    }

    if (isSpaceKey(key) || isRightKey(key)) {
      const current = items[cursor];
      if (current === DELETE_ROW) {
        submit();
        return;
      }
      if (current.disabled) return;
      const next = new Set(selected);
      if (next.has(current.value)) next.delete(current.value);
      else next.add(current.value);
      setSelected(next);
    }
  });

  const renderItem = (item, idx) => {
    const isCursor = idx === cursor;
    const pointer = isCursor ? `${C.cyan}❯${C.reset}` : " ";

    if (item === DELETE_ROW) {
      const count = selected.size;
      const label = `Delete ${count} marked branch${count === 1 ? "" : "es"}`;
      const color = count > 0 ? C.red : C.dim;
      const bold = isCursor ? C.bold : "";
      return `${pointer} ${bold}${color}▶ ${label}${C.reset}`;
    }

    const isSelected = selected.has(item.value);
    const box = item.disabled
      ? `${C.dim}[-]${C.reset}`
      : isSelected
        ? `${C.green}[x]${C.reset}`
        : "[ ]";
    const padded = displayName(item).padEnd(maxDisplayLen);
    const name = item.disabled ? `${C.dim}${padded}${C.reset}` : padded;
    const commits = item.commits == null ? "?" : String(item.commits);
    const metaParts = [item.date, commits.padEnd(7)];
    if (BASE) {
      const ahead = item.ahead == null ? "—" : String(item.ahead);
      metaParts.push(ahead.padEnd(5));
    }
    const meta = `${C.dim}${metaParts.join("  ")}${C.reset}`;
    return `${pointer} ${box} ${name}  ${meta}`;
  };

  if (submitted) {
    const count = selected.size;
    return `${prefix} ${message} ${C.dim}(${count} selected)${C.reset}`;
  }

  const headerCols = [
    "Branch".padEnd(maxDisplayLen),
    "Updated".padEnd(10),
    "Commits".padEnd(7),
  ];
  if (BASE) headerCols.push("Ahead".padEnd(5));
  const header = `${C.dim}      ${headerCols.join("  ")}${C.reset}`;
  const lines = items.map(renderItem).join("\n");
  const help = `${C.dim}  (↑/↓ navigate, space/→ toggle, enter delete)${C.reset}`;
  return [`${prefix} ${message}`, "", header, lines, help].join("\n");
});

const deleteBranch = (branch) => {
  if (DRY_RUN) {
    console.log(
      `${C.yellow}[dry-run]${C.reset} would delete ${C.bold}${branch}${C.reset}`,
    );
    return { ok: true };
  }
  try {
    execSync(`git push ${REMOTE} --delete ${branch}`, { stdio: "pipe" });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.stderr?.toString() || err.message };
  }
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
  const branches = fetchAndListRemoteBranches();

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

  const repoDefault = getRepoDefaultBranch();
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

  // const label = BASE
  //   ? `Counting commits (total and ahead of ${BASE})...`
  //   : "Counting commits...";
  const label = "Counting commits...";
  process.stdout.write(`${C.cyan}${label}${C.reset}`);
  for (const b of branches) {
    b.commits = getCommitCount(b.name);
    if (BASE) b.ahead = getCommitsAhead(b.name, BASE);
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
    const maxDisplayLen = rows.reduce(
      (m, r) => Math.max(m, r.display.length),
      0,
    );
    const headerCols = [
      "Branch".padEnd(maxDisplayLen),
      "Updated".padEnd(10),
      "Commits".padEnd(7),
    ];
    if (BASE) headerCols.push("Ahead".padEnd(5));
    console.log("");
    console.log(`${C.dim}      ${headerCols.join("  ")}${C.reset}`);
    for (const r of rows) {
      const padded = r.display.padEnd(maxDisplayLen);
      const commits = r.commits == null ? "?" : String(r.commits);
      const parts = [padded, r.date, commits.padEnd(7)];
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
      commits: b.commits,
      ahead: b.ahead,
      disabled: disabled ? reason : false,
    };
  });

  const selected = await branchCheckbox({
    message: `Select branches to delete from ${REMOTE}:`,
    choices,
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
    const result = deleteBranch(branch);
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
