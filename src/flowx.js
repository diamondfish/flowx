#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { confirm } from '@inquirer/prompts';
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
} from '@inquirer/core';

const PROTECTED = new Set([
  'master',
  'main',
  'develop',
  'production',
  'staging',
  'prod',
]);

const REMOTE = 'origin';
const DRY_RUN = process.argv.includes('--dry-run');

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[90m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

const git = (args) => execSync(`git ${args}`, { encoding: 'utf8' }).trim();

const isInsideGitRepo = () => {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

const hasRemote = (name) => {
  try {
    execSync(`git remote get-url ${name}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

const getCurrentBranch = () => {
  try {
    return git('rev-parse --abbrev-ref HEAD');
  } catch {
    return null;
  }
};

const fetchAndListRemoteBranches = () => {
  console.log(`${C.cyan}Fetching from ${REMOTE}...${C.reset}`);
  execSync(`git fetch --prune ${REMOTE}`, { stdio: 'inherit' });
  const raw = git(`for-each-ref --format=%(refname) refs/remotes/${REMOTE}`);
  const prefix = `refs/remotes/${REMOTE}/`;
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => s.startsWith(prefix))
    .map((s) => s.slice(prefix.length))
    .filter((b) => b !== 'HEAD')
    .sort();
};

const isProtected = (branch, currentBranch) =>
  PROTECTED.has(branch) || branch === currentBranch;

const DELETE_ROW = Symbol('delete-row');
const isRightKey = (key) => key && key.name === 'right';

const branchCheckbox = createPrompt((config, done) => {
  const { message, choices } = config;
  const theme = makeTheme();
  const prefix = usePrefix({ theme });

  const items = [...choices, DELETE_ROW];
  const firstSelectable = choices.findIndex((c) => !c.disabled);
  const initialCursor = firstSelectable >= 0 ? firstSelectable : items.length - 1;

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
    const pointer = isCursor ? `${C.cyan}❯${C.reset}` : ' ';

    if (item === DELETE_ROW) {
      const count = selected.size;
      const label = `Delete ${count} marked branch${count === 1 ? '' : 'es'}`;
      const color = count > 0 ? C.red : C.dim;
      const bold = isCursor ? C.bold : '';
      return `${pointer} ${bold}${color}▶ ${label}${C.reset}`;
    }

    const isSelected = selected.has(item.value);
    const box = item.disabled
      ? `${C.dim}[-]${C.reset}`
      : isSelected
        ? `${C.green}[x]${C.reset}`
        : '[ ]';
    const name = item.disabled ? `${C.dim}${item.name}${C.reset}` : item.name;
    const tag = item.disabled
      ? ` ${C.dim}(${typeof item.disabled === 'string' ? item.disabled : 'protected'})${C.reset}`
      : '';
    return `${pointer} ${box} ${name}${tag}`;
  };

  if (submitted) {
    const count = selected.size;
    return `${prefix} ${message} ${C.dim}(${count} selected)${C.reset}`;
  }

  const lines = items.map(renderItem).join('\n');
  const help = `${C.dim}  (↑/↓ navigate, space/→ toggle, enter delete)${C.reset}`;
  return [`${prefix} ${message}`, lines, help].join('\n');
});

const deleteBranch = (branch) => {
  if (DRY_RUN) {
    console.log(`${C.yellow}[dry-run]${C.reset} would delete ${C.bold}${branch}${C.reset}`);
    return { ok: true };
  }
  try {
    execSync(`git push ${REMOTE} --delete ${branch}`, { stdio: 'pipe' });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.stderr?.toString() || err.message };
  }
};

const main = async () => {
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

  const deletableCount = branches.filter(
    (b) => !isProtected(b, currentBranch),
  ).length;

  if (deletableCount === 0) {
    console.log(
      `${C.yellow}Only protected branches exist on ${REMOTE}. Nothing to delete.${C.reset}`,
    );
    process.exit(0);
  }

  if (DRY_RUN) {
    console.log(`${C.yellow}${C.bold}[DRY-RUN MODE]${C.reset} ${C.yellow}no branches will actually be deleted${C.reset}\n`);
  }

  const choices = branches.map((b) => {
    const disabled = isProtected(b, currentBranch);
    const reason = PROTECTED.has(b)
      ? 'protected'
      : b === currentBranch
        ? 'current HEAD'
        : false;
    return {
      name: b,
      value: b,
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
  console.log('');

  const ok = await confirm({
    message: `Delete ${selected.length} branch${selected.length === 1 ? '' : 'es'} from ${REMOTE}? This cannot be undone.`,
    default: false,
  });

  if (!ok) {
    console.log(`${C.dim}Aborted. No branches were deleted.${C.reset}`);
    process.exit(0);
  }

  console.log('');
  const results = [];
  for (const branch of selected) {
    process.stdout.write(`Deleting ${branch}... `);
    const result = deleteBranch(branch);
    if (result.ok) {
      console.log(`${C.green}✔${C.reset}`);
    } else {
      console.log(`${C.red}✖${C.reset}`);
      console.log(`  ${C.red}${result.error.trim().split('\n').join('\n  ')}${C.reset}`);
    }
    results.push({ branch, ...result });
  }

  const failures = results.filter((r) => !r.ok);
  console.log('');
  console.log(
    `${C.bold}Done.${C.reset} ${C.green}${results.length - failures.length} deleted${C.reset}` +
      (failures.length ? `, ${C.red}${failures.length} failed${C.reset}` : ''),
  );
  process.exit(failures.length ? 1 : 0);
};

main().catch((err) => {
  if (err && err.name === 'ExitPromptError') {
    console.log(`\n${C.dim}Cancelled.${C.reset}`);
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});
