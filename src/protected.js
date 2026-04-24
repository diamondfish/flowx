export const buildProtectedMatcher = (patterns) => {
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
