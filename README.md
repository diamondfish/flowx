# flowx

Interactive CLI for cleaning up remote git branches. Fetches branches from the configured remote (default `origin`), lets you pick the ones you want gone with a keyboard-driven checklist, and deletes them after confirmation.

Protected branches (by default `master`, `main`, `develop`, `development`, `prod`, `production`, `staging`) and the branch you are currently on cannot be selected. The remote and the list of protected branches can be customized in a `.flowxrc` config file — see [Configuration](#configuration).

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

### Keys

| Key        | Action                                         |
| ---------- | ---------------------------------------------- |
| `↑` / `↓`  | Move cursor                                    |
| `space` / `→` | Toggle selection on the highlighted branch  |
| `enter`    | Confirm selection and proceed to delete prompt |
| `ctrl+c`   | Cancel                                         |

## Configuration

flowx can be configured with a `.flowxrc` file written in JSON with support for `//` line and `/* */` block comments. By default it is read from the current working directory — if it doesn't exist, built-in defaults are used.

The first time you run `flowx` in a git repo without a `.flowxrc`, it prompts you to pick a base branch and writes the config for you (cursor defaults to `develop`/`development` if either exists). Pick `— no base` to skip.

Supported keys:

- `remote` (string) — name of the git remote to operate on. Defaults to `"origin"`.
- `base` (string or null) — branch used as the base for the `Ahead` column (e.g. `"develop"`). When set, the `Ahead` column is shown and counts commits on each branch that are not on `base`. Set to `null` to hide the column entirely.
- `protected` (string[]) — list of branch names or glob patterns that cannot be deleted. Entries containing `*` are matched as globs (e.g. `"hotfix/*"` matches `hotfix/anything`), entries without `*` must match exactly. **Replaces** the built-in default list when present. The `base` branch is always protected automatically.

The config format supports `//` line comments, `/* */` block comments, and trailing commas.

### Example `.flowxrc`

```jsonc
{
  // Operate on a different remote than origin
  "remote": "github",

  // Count "Ahead" commits relative to develop instead of main
  "base": "develop",

  // Only these are treated as protected
  "protected": ["main", "develop"]
}
```

### Custom config path

Point flowx at a config file somewhere else with `--config <path>` (short form `-c <path>`). Accepts both space- and `=`-separated forms:

```bash
flowx --config ./configs/work.flowxrc
flowx -c ~/.config/flowx.json
flowx --config=.flowxrc.prod
```

If the specified file does not exist, flowx exits with an error.

### Generate a starter config

Create a `.flowxrc` with the defaults using `--write-config` (short form `-w`). With no path argument it writes `.flowxrc` in the current directory. Pass a path to write elsewhere:

```bash
flowx --write-config
flowx --write-config ./team.flowxrc
flowx -w ~/.config/flowx.json
```

If the target file already exists you will be prompted before it is overwritten.

## How it works

1. Verifies you are inside a git repository and that the configured remote exists.
2. Runs `git fetch --prune <remote>`.
3. Lists remote branches under `refs/remotes/<remote>/` with last-commit date and total commit count.
4. After confirmation, deletes each selected branch with `git push <remote> --delete <branch>`.

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
