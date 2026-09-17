import { getConfig } from "./config.js";
import {
  getAccessToken,
  fetchAllTasksForBoard,
  resolveProjectBoards,
  updateTaskOwner
} from "./zoho-projects-client.js";
import { getTaskId, getTaskName } from "./task-normalizer.js";
import {
  buildOwnerEmailByTag,
  resolveTaskOwnerEmail,
  resolveOwners,
  taskHasOwner,
  normalizeName
} from "./qa-task-owner-resolver.js";

const DEFAULT_QA_BOARD_NAME = "QA TASK BOARD";
const DEFAULT_QA_TASKLIST_NAME = "Task from DEV Board";
const UNASSIGNED_OWNER_NAME = "unassigned user";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = getConfig();

  const accessToken = await getAccessToken(config);
  const boards = await resolveProjectBoards(config, accessToken);
  const qaBoard = findBoard(boards, options.qaBoardName, options.qaProjectId);

  const ownerEmailByTag = buildOwnerEmailByTag(config.projectCliqMentions);
  const defaultOwnerEmail = normalizeName(process.env.QA_DEV_DEFAULT_OWNER_EMAIL);
  const ownerByEmail = await resolveOwners({
    config,
    accessToken,
    qaBoard,
    candidateEmails: [...new Set([...ownerEmailByTag.values(), defaultOwnerEmail].filter(Boolean))]
  });

  console.log(`Mode: ${options.execute ? "execute" : "dry-run"}`);
  console.log(`QA board: ${qaBoard.name} (${qaBoard.portalId}/${qaBoard.projectId})`);
  console.log(`Task list filter: ${options.tasklistName || "(all task lists)"}`);
  console.log(`Project-tag owner mappings loaded: ${ownerEmailByTag.size}`);
  console.log(`Default owner email: ${defaultOwnerEmail || "none"}`);
  console.log(
    options.skipAssigned
      ? "Sync mode: only fill in currently-unassigned tasks (--skip-assigned)."
      : "Sync mode: reassign any task whose current owner doesn't match the mapping."
  );

  const qaTasks = await fetchAllTasksForBoard(config, accessToken, qaBoard);
  const normalizedTasklistFilter = normalizeName(options.tasklistName);
  const scopedTasks = normalizedTasklistFilter
    ? qaTasks.filter((task) => normalizeName(task.tasklist?.name) === normalizedTasklistFilter)
    : qaTasks;

  console.log(`Tasks in scope: ${scopedTasks.length} of ${qaTasks.length} total on the board.`);

  let matched = 0;
  let alreadyCorrect = 0;
  let skippedAssigned = 0;
  let ambiguous = 0;
  let unresolved = 0;
  let updated = 0;
  let processed = 0;

  for (const task of scopedTasks) {
    if (options.limit !== undefined && processed >= options.limit) {
      break;
    }

    const ownerResolution = resolveTaskOwnerEmail(task, ownerEmailByTag, defaultOwnerEmail);

    if (ownerResolution.ambiguous) {
      ambiguous++;
      console.warn(
        `Skipping "${getTaskName(task)}" (${getTaskId(task)}): matches multiple project tags with different owners (${ownerResolution.matchedEmails.join(", ")}).`
      );
      continue;
    }

    if (!ownerResolution.email) {
      continue;
    }

    matched++;

    const owner = ownerByEmail.get(ownerResolution.email);

    if (!owner) {
      unresolved++;
      continue;
    }

    const currentOwnerId = getCurrentOwnerId(task);

    if (currentOwnerId && String(currentOwnerId) === String(owner.id)) {
      alreadyCorrect++;
      continue;
    }

    if (options.skipAssigned && currentOwnerId) {
      skippedAssigned++;
      continue;
    }

    processed++;

    const verb = currentOwnerId ? "reassign" : "assign";

    if (!options.execute) {
      console.log(`Would ${verb} "${getTaskName(task)}" (${getTaskId(task)}) -> ${owner.name} (${owner.id})`);
      continue;
    }

    const updatedTask = await updateTaskOwner(config, accessToken, qaBoard, getTaskId(task), owner.id);
    updated++;
    console.log(`${verb === "assign" ? "Assigned" : "Reassigned"} "${getTaskName(task)}" (${getTaskId(task)}) -> ${owner.name} (${owner.id})`);

    if (!taskHasOwner(updatedTask, owner.id)) {
      console.warn(
        `Warning: could not confirm "${owner.name}" (${owner.id}) was assigned on this task. Check it in Zoho Projects.`
      );
    }
  }

  console.log("---");
  console.log(`Matched a project tag: ${matched}`);
  console.log(`Already correct (no change needed): ${alreadyCorrect}`);
  console.log(`Skipped (has a different manual owner, --skip-assigned): ${skippedAssigned}`);
  console.log(`Skipped (ambiguous tags): ${ambiguous}`);
  console.log(`Skipped (owner email unresolved): ${unresolved}`);
  console.log(options.execute ? `Updated: ${updated}` : `Would update: ${processed}`);
}

function getCurrentOwnerId(task) {
  const owners = task.owners_and_work?.owners || task.details?.owners || task.owners;

  if (!Array.isArray(owners) || owners.length === 0) {
    return null;
  }

  const realOwner = owners.find((owner) => normalizeName(owner.name) !== UNASSIGNED_OWNER_NAME);
  return realOwner ? String(realOwner.id || realOwner.zpuid || "") || null : null;
}

function findBoard(boards, boardName, projectId) {
  const normalizedName = normalizeName(boardName);
  const matches = boards.filter((board) => {
    if (projectId) {
      return String(board.projectId) === String(projectId);
    }

    return normalizeName(board.name) === normalizedName;
  });

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length === 0) {
    throw new Error(`Could not find board "${boardName}". Set QA_DEV_QA_PROJECT_ID if the name differs.`);
  }

  throw new Error(`Found multiple boards named "${boardName}". Set QA_DEV_QA_PROJECT_ID.`);
}

function parseArgs(args) {
  const options = {
    execute: false,
    skipAssigned: false,
    limit: undefined,
    qaBoardName: process.env.QA_DEV_QA_BOARD_NAME || DEFAULT_QA_BOARD_NAME,
    qaProjectId: process.env.QA_DEV_QA_PROJECT_ID || "",
    tasklistName:
      process.env.QA_DEV_TASKLIST_NAME !== undefined ? process.env.QA_DEV_TASKLIST_NAME : DEFAULT_QA_TASKLIST_NAME
  };

  for (const arg of args) {
    if (arg === "--execute") {
      options.execute = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.execute = false;
      continue;
    }

    if (arg === "--skip-assigned") {
      options.skipAssigned = true;
      continue;
    }

    if (arg === "--all-tasklists") {
      options.tasklistName = "";
      continue;
    }

    const [key, value = ""] = arg.split("=");

    if (key === "--limit") {
      const limit = Number.parseInt(value, 10);

      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error("--limit must be a positive integer.");
      }

      options.limit = limit;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

main().catch((error) => {
  console.error("QA task owner assignment failed:", error.response?.data || error.message);
  process.exit(1);
});
