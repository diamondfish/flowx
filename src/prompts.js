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
import { C } from "./colors.js";

const DELETE_ROW = Symbol("delete-row");
const isRightKey = (key) => key && key.name === "right";

const displayName = (item) => {
  if (!item.disabled) return item.name;
  const reason =
    typeof item.disabled === "string" ? item.disabled : "protected";
  return `${item.name} (${reason})`;
};

export const branchCheckbox = createPrompt((config, done) => {
  const { message, choices, showAhead } = config;
  const theme = makeTheme();
  const prefix = usePrefix({ theme });

  const items = [...choices, DELETE_ROW];
  const maxDisplayLen = choices.reduce(
    (m, c) => Math.max(m, displayName(c).length),
    0,
  );
  const updatedCol = (item) =>
    item.relative ? `${item.date} (${item.relative})` : item.date;
  const maxUpdatedLen = choices.reduce(
    (m, c) => Math.max(m, updatedCol(c).length),
    "Updated".length,
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
    const metaParts = [updatedCol(item).padEnd(maxUpdatedLen), commits.padEnd(7)];
    if (showAhead) {
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
    "Updated".padEnd(maxUpdatedLen),
    "Commits".padEnd(7),
  ];
  if (showAhead) headerCols.push("Ahead".padEnd(5));
  const header = `${C.dim}      ${headerCols.join("  ")}${C.reset}`;
  const lines = items.map(renderItem).join("\n");
  const help = `${C.dim}  (↑/↓ navigate, space/→ toggle, enter delete)${C.reset}`;
  return [`${prefix} ${message}`, "", header, lines, help].join("\n");
});
