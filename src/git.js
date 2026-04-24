import { execSync } from "node:child_process";

const git = (args) => execSync(`git ${args}`, { encoding: "utf8" }).trim();

export const isInsideGitRepo = () => {
  try {
    execSync("git rev-parse --is-inside-work-tree", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};

export const hasRemote = (name) => {
  try {
    execSync(`git remote get-url ${name}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};

export const getCurrentBranch = () => {
  try {
    return git("rev-parse --abbrev-ref HEAD");
  } catch {
    return null;
  }
};

export const createRemoteClient = (remote) => ({
  name: remote,

  fetchPrune: () => {
    execSync(`git fetch --prune ${remote}`, { stdio: "pipe" });
  },

  listBranches: () => {
    const raw = git(
      `for-each-ref --format=%(refname)%09%(committerdate:short)%09%(committerdate:relative) refs/remotes/${remote}`,
    );
    const prefix = `refs/remotes/${remote}/`;
    return raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((line) => {
        const [refname, date, relative] = line.split("\t");
        return { refname, date, relative };
      })
      .filter((r) => r.refname.startsWith(prefix))
      .map((r) => ({
        name: r.refname.slice(prefix.length),
        date: r.date,
        relative: r.relative,
      }))
      .filter((b) => b.name !== "HEAD")
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  getDefaultBranch: () => {
    try {
      const ref = git(`symbolic-ref --short refs/remotes/${remote}/HEAD`);
      const prefix = `${remote}/`;
      if (ref.startsWith(prefix)) return ref.slice(prefix.length);
    } catch {
      // origin/HEAD not set
    }
    return null;
  },

  getCommitCount: (branch) => {
    try {
      return Number(git(`rev-list --count refs/remotes/${remote}/${branch}`));
    } catch {
      return null;
    }
  },

  getCommitsAhead: (branch, base) => {
    if (!base) return null;
    try {
      return Number(
        git(
          `rev-list --count refs/remotes/${remote}/${base}..refs/remotes/${remote}/${branch}`,
        ),
      );
    } catch {
      return null;
    }
  },

  deleteBranch: (branch) => {
    try {
      execSync(`git push ${remote} --delete ${branch}`, { stdio: "pipe" });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.stderr?.toString() || err.message };
    }
  },
});
