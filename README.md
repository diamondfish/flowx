# flowx

Interactive CLI for cleaning up remote git branches. Fetches branches from the configured remote (default `origin`), lets you pick the ones you want gone with a keyboard-driven checklist, and deletes them after confirmation.

Protected branches (by default `master`, `main`, `develop`, `development`, `prod`, `production`, `staging`) and the branch you are currently on cannot be selected. The remote and the list of protected branches can be customized in a `.flowx.jsonc` config file — see [Configuration](#configuration).

## Install

Install globally from GitHub:

```bash
npm install -g github:diamondfish/flowx
```

Requires Node.js 18 or later, and `git` available on your `PATH`.

## Usage

From any git repository with an `origin` remote:

```bash
flowx
```

Dry run — shows what would be deleted without touching the remote:

```bash
flowx --dry-run
```

### List format

Each row in the interactive list shows the branch name, the date of its last commit (with a relative "X days ago" hint), and the total number of commits on it. When a `base` branch is configured, an `Ahead` column is added, showing how many commits that branch has that are not on `base`.

```
? Select branches to delete from origin:

        Branch                       Updated                     Commits  Ahead
    [-] develop (base)               2025-04-22 (2 hours ago)    8479     1
    [-] feature/mine (current HEAD)  2024-12-01 (3 weeks ago)    8440     8
  ❯ [ ] feature/new-thing            2024-11-20 (2 days ago)     8435     3
    [ ] feature/stale                2024-05-02 (6 months ago)   8444     12
    [-] main (default)               2025-04-24 (4 minutes ago)  8432     0
    [-] staging (protected)          2025-03-24 (1 month ago)    8455     3
    ▶ Delete 0 selected branches
  (↑/↓ navigate, space/→ toggle, enter delete)
```

Disabled rows (`[-]`) cannot be selected and are tagged with the reason:

- `(default)` — the repo's default branch (from `origin/HEAD`)
- `(base)` — the configured base branch (see [Configuration](#configuration))
- `(default/base)` — when the same branch is both the repo default and the configured base
- `(current HEAD)` — the branch you are currently checked out on
- `(protected)` — matches an entry in `protected` (see [Configuration](#configuration))

### Keys

| Key           | Action                                         |
| ------------- | ---------------------------------------------- |
| `↑` / `↓`     | Move cursor                                    |
| `space` / `→` | Toggle selection on the highlighted branch     |
| `enter`       | Confirm selection and proceed to delete prompt |
| `ctrl+c`      | Cancel                                         |

## Configuration

flowx can be configured with a `.flowx.jsonc` file written in JSON with support for `//` line and `/* */` block comments. The `.jsonc` extension lets VS Code and JetBrains IDEs highlight the file as JSON-with-comments out of the box. By default the config is read from the current working directory.

The first time you run `flowx` in a git repo without a `.flowx.jsonc`, it prompts you to pick a base branch and writes the config for you.

Supported keys:

- `remote` (string) — name of the git remote to operate on. Defaults to `"origin"`.
- `base` (string or null) — branch used as the base for the `Ahead` column (e.g. `"develop"`). When set, the `Ahead` column is shown and counts commits on each branch that are not on `base`. Set to `null` to hide the column entirely.
- `protected` (string[]) — list of branch names or glob patterns that cannot be deleted. Entries containing `*` are matched as globs (e.g. `"hotfix/*"` matches `hotfix/anything`), entries without `*` must match exactly. **Replaces** the built-in default list when present. The `base` branch is always protected automatically.

The config format supports `//` line comments, `/* */` block comments, and trailing commas.

### Example `.flowx.jsonc`

```jsonc
{
  // Operate on a different remote than origin
  "remote": "github",

  // Count "Ahead" commits relative to develop instead of main
  "base": "develop",

  // Treat these as protected. Entries with "*" are matched as globs.
  "protected": ["main", "develop", "release/*", "hotfix/*"]
}
```

### Custom config path

Point flowx at a config file somewhere else with `--config <path>` (short form `-c <path>`). Accepts both space- and `=`-separated forms:

```bash
flowx --config ./configs/work.flowx.jsonc
flowx -c ~/.config/flowx.jsonc
flowx --config=.flowx.prod.jsonc
```

If the specified file does not exist, flowx exits with an error.

### Generate a starter config

Create a `.flowx.jsonc` with the defaults using `--write-config` (short form `-w`). With no path argument it writes `.flowx.jsonc` in the current directory. Pass a path to write elsewhere:

```bash
flowx --write-config
flowx --write-config ./team.flowx.jsonc
flowx -w ~/.config/flowx.jsonc
```

If the target file already exists you will be prompted before it is overwritten.

## How it works

1. Verifies you are inside a git repository and that the configured remote exists.
2. Runs `git fetch --prune <remote>`.
3. If no `.flowx.jsonc` is found, runs the init prompt to pick a base branch and writes the file.
4. Lists remote branches under `refs/remotes/<remote>/` with last-commit date (including a relative "X days ago" hint), total commit count, and — when `base` is set — commits ahead of `base`.
5. After confirmation, deletes each selected branch with `git push <remote> --delete <branch>`.

## Develop

```bash
git clone https://github.com/diamondfish/flowx.git
cd flowx
npm install
npm link       # makes `flowx` available globally, pointing at your working copy
```

Unlink when done:

```bash
npm unlink -g flowx
```

## License

MIT — see [LICENSE](LICENSE).
