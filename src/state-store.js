import fs from "fs";
import path from "path";

export function loadState(filePath) {
  ensureParentDirectory(filePath);

  if (!fs.existsSync(filePath)) {
    return { notified: {}, lastSeenStatusByTask: {} };
  }

  const raw = fs.readFileSync(filePath, "utf8").trim();

  if (!raw) {
    return { notified: {}, lastSeenStatusByTask: {} };
  }

  const parsed = JSON.parse(raw);

  return {
    notified: parsed.notified || {},
    lastSeenStatusByTask: parsed.lastSeenStatusByTask || {}
  };
}

export function saveState(filePath, state) {
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

function ensureParentDirectory(filePath) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
}
