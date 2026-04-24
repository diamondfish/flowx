# flowx

Interactive CLI for cleaning up remote git branches. Fetches branches from `origin`, lets you pick the ones you want gone with a keyboard-driven checklist, and deletes them after confirmation.

Protected branches (`master`, `main`, `develop`, `production`, `staging`, `prod`) and the branch you are currently on cannot be selected.

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

## How it works

1. Verifies you are inside a git repository and that `origin` exists.
2. Runs `git fetch --prune origin`.
3. Lists remote branches under `refs/remotes/origin/`.
4. After confirmation, deletes each selected branch with `git push origin --delete <branch>`.

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
