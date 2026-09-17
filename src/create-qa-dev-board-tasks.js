import axios from "axios";
import { getConfig } from "./config.js";
import { getAccessToken, fetchAllTasksForBoard, resolveProjectBoards } from "./zoho-projects-client.js";
import { getStatusName, getTaskId, getTaskName } from "./task-normalizer.js";
import {
  buildOwnerEmailByTag,
  resolveTaskOwnerEmail,
  resolveOwners,
  taskHasOwner,
  isInvalidOAuthScope
} from "./qa-task-owner-resolver.js";

const DEFAULT_SOURCE_BOARDS = [
  { name: "FRONTEND TASK BOARD", origin: "frontend", originTag: "FRONTEND" },
  { name: "BACKEND TASK BOARD", origin: "backend", originTag: "BACKEND" }
];
const DEFAULT_QA_BOARD_NAME = "QA TASK BOARD";
const DEFAULT_QA_TASKLIST_NAME = "Task from DEV Board";
const TARGET_STATUS_KEYS = new Set(["testing", "pushed to qa"]);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = getConfig();
  validateManualConfig(config);

  const accessToken = await getAccessToken(config);
  const boards = await resolveProjectBoards(config, accessToken);
  const qaBoard = findBoard(boards, options.qaBoardName, options.qaProjectId);
  const sourceBoards = DEFAULT_SOURCE_BOARDS.map((sourceBoard) => ({
    ...sourceBoard,
    board: findBoard(
      boards,
      options.sourceProjectIds[sourceBoard.origin]?.name || sourceBoard.name,
      options.sourceProjectIds[sourceBoard.origin]?.projectId
    )
  }));

  const qaTasks = await fetchAllTasksForBoard(config, accessToken, qaBoard);
  const qaTasklist = resolveQaTasklist(qaTasks, options.qaTasklistName, options.qaTasklistId);
  const existingQaTaskIndex = buildExistingQaTaskIndex(qaTasks);
  const portalTagsByName = await collectKnownTags(config, accessToken, [qaBoard, ...sourceBoards.map(({ board }) => board)]);

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
  console.log(`QA task list: ${qaTasklist.name} (${qaTasklist.id})`);
  console.log(`Limit per source board: ${Number.isFinite(options.limitPerBoard) ? options.limitPerBoard : "all"}`);
  console.log(`Project-tag owner mappings loaded: ${ownerEmailByTag.size}`);
  console.log(`Default owner email: ${defaultOwnerEmail || "none"}`);

  const plannedCreates = [];

  for (const sourceBoard of sourceBoards) {
    const sourceTasks = await fetchAllTasksForBoard(config, accessToken, sourceBoard.board);
    const matchingTasks = sourceTasks.filter(isTargetStatusTask);
    const uniqueTasks = options.allowDuplicates
      ? matchingTasks
      : matchingTasks.filter((task) => !isAlreadyInQa(sourceBoard.board, task, existingQaTaskIndex));
    const limitedTasks = uniqueTasks.slice(0, options.limitPerBoard);

    console.log(
      `${sourceBoard.board.name}: fetched ${sourceTasks.length}, matched ${matchingTasks.length}, already in QA ${matchingTasks.length - uniqueTasks.length}, selected ${limitedTasks.length}.`
    );

    for (const task of limitedTasks) {
      plannedCreates.push({ sourceBoard, task });
    }
  }

  if (plannedCreates.length === 0) {
    console.log("No QA tickets to create.");
    return;
  }

  const originTagIds = await ensureOriginTags({
    config,
    accessToken,
    portalId: qaBoard.portalId,
    portalTagsByName,
    originTagNames: [...new Set(plannedCreates.map(({ sourceBoard }) => sourceBoard.originTag))],
    execute: options.execute
  });

  for (const { sourceBoard, task } of plannedCreates) {
    const ownerResolution = resolveTaskOwnerEmail(task, ownerEmailByTag, defaultOwnerEmail);

    if (ownerResolution.ambiguous) {
      console.warn(
        `Warning: "${getTaskName(task)}" (${sourceBoard.board.name}) matches multiple project tags with different owners (${ownerResolution.matchedEmails.join(", ")}). Creating unassigned.`
      );
    }

    const owner = ownerResolution.email ? ownerByEmail.get(ownerResolution.email) : null;

    if (ownerResolution.email && !owner) {
      console.warn(
        `Warning: owner email "${ownerResolution.email}" for "${getTaskName(task)}" (${sourceBoard.board.name}) could not be resolved. Creating unassigned.`
      );
    }

    const payload = buildCreateTaskPayload({
      task,
      sourceBoard: sourceBoard.board,
      originTagName: sourceBoard.originTag,
      originTagId: originTagIds.get(sourceBoard.originTag),
      qaTasklist,
      ownerId: owner?.id,
      includeRawTaskJson: options.includeRawTaskJson,
      maxRawTaskJsonChars: options.maxRawTaskJsonChars
    });

    if (!options.execute) {
      printDryRunCreate(sourceBoard.board, task, payload, owner);
      continue;
    }

    const createdTask = await createQaTask(config, accessToken, qaBoard, payload);
    console.log(
      `Created QA task for ${sourceBoard.board.name}: ${getTaskName(task)} -> ${getTaskId(createdTask) || "created"}${owner ? ` (owner: ${owner.name})` : ""}`
    );

    if (owner && !taskHasOwner(createdTask, owner.id)) {
      console.warn(
        `Warning: could not confirm "${owner.name}" (${owner.id}) was assigned as owner on the created task. Check it in Zoho Projects.`
      );
    }
  }
}

function parseArgs(args) {
  const options = {
    execute: false,
    allowDuplicates: false,
    includeRawTaskJson: false,
    maxRawTaskJsonChars: 15000,
    limitPerBoard: 1,
    qaBoardName: process.env.QA_DEV_QA_BOARD_NAME || DEFAULT_QA_BOARD_NAME,
    qaProjectId: process.env.QA_DEV_QA_PROJECT_ID || "",
    qaTasklistName: process.env.QA_DEV_TASKLIST_NAME || DEFAULT_QA_TASKLIST_NAME,
    qaTasklistId: process.env.QA_DEV_TASKLIST_ID || "",
    sourceProjectIds: {
      frontend: {
        name: process.env.QA_DEV_FRONTEND_BOARD_NAME || "FRONTEND TASK BOARD",
        projectId: process.env.QA_DEV_FRONTEND_PROJECT_ID || ""
      },
      backend: {
        name: process.env.QA_DEV_BACKEND_BOARD_NAME || "BACKEND TASK BOARD",
        projectId: process.env.QA_DEV_BACKEND_PROJECT_ID || ""
      }
    }
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

    if (arg === "--allow-duplicates") {
      options.allowDuplicates = true;
      continue;
    }

    if (arg === "--no-raw-json") {
      options.includeRawTaskJson = false;
      continue;
    }

    if (arg === "--include-raw-json") {
      options.includeRawTaskJson = true;
      continue;
    }

    if (arg === "--all") {
      options.limitPerBoard = Number.POSITIVE_INFINITY;
      continue;
    }

    const [key, value = ""] = arg.split("=");

    if (key === "--limit-per-board") {
      options.limitPerBoard = parseLimit(value);
      continue;
    }

    if (key === "--max-raw-json-chars") {
      options.maxRawTaskJsonChars = Number.parseInt(value, 10);
      if (!Number.isInteger(options.maxRawTaskJsonChars) || options.maxRawTaskJsonChars < 0) {
        throw new Error("--max-raw-json-chars must be a non-negative integer.");
      }
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function validateManualConfig(config) {
  const missing = [];

  if (!config.zohoClientId) {
    missing.push("ZOHO_CLIENT_ID");
  }

  if (!config.zohoClientSecret) {
    missing.push("ZOHO_CLIENT_SECRET");
  }

  if (!config.zohoRefreshToken) {
    missing.push("ZOHO_REFRESH_TOKEN");
  }

  if (config.monitorAllProjects && config.discoveryPortalIds.length === 0) {
    missing.push("ZOHO_PORTAL_ID or ZOHO_PORTAL_IDS");
  }

  if (!config.monitorAllProjects && config.projectBoards.length === 0) {
    missing.push("MONITOR_ALL_PROJECTS=true or configured project IDs");
  }

  if (missing.length > 0) {
    throw new Error(`Missing configuration for QA dev-board migration: ${missing.join(", ")}`);
  }
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
    throw new Error(`Could not find board "${boardName}". Set the matching QA_DEV_*_PROJECT_ID env var if names differ.`);
  }

  throw new Error(`Found multiple boards named "${boardName}". Set the matching QA_DEV_*_PROJECT_ID env var.`);
}

function resolveQaTasklist(qaTasks, qaTasklistName, qaTasklistId) {
  if (qaTasklistId) {
    return { id: qaTasklistId, name: qaTasklistName };
  }

  const matches = [];
  const normalizedTasklistName = normalizeName(qaTasklistName);

  for (const task of qaTasks) {
    const tasklist = task.tasklist || {};

    if (normalizeName(tasklist.name) === normalizedTasklistName && tasklist.id) {
      matches.push({ id: String(tasklist.id), name: String(tasklist.name || qaTasklistName) });
    }
  }

  const uniqueMatches = [...new Map(matches.map((match) => [match.id, match])).values()];

  if (uniqueMatches.length === 1) {
    return uniqueMatches[0];
  }

  if (uniqueMatches.length === 0) {
    throw new Error(`Could not discover QA task list "${qaTasklistName}" from existing QA tasks. Set QA_DEV_TASKLIST_ID.`);
  }

  throw new Error(`Found multiple QA task lists named "${qaTasklistName}". Set QA_DEV_TASKLIST_ID.`);
}

async function collectKnownTags(config, accessToken, boards) {
  const tagsByName = new Map();

  for (const board of boards) {
    const tasks = await fetchAllTasksForBoard(config, accessToken, board);

    for (const task of tasks) {
      for (const tag of task.tags || []) {
        addKnownTag(tagsByName, tag);
      }
    }
  }

  return tagsByName;
}

async function ensureOriginTags({ config, accessToken, portalId, portalTagsByName, originTagNames, execute }) {
  const tagIds = new Map();

  for (const originTagName of originTagNames) {
    const configuredTagId = process.env[`QA_DEV_${originTagName.toUpperCase()}_TAG_ID`];

    if (configuredTagId) {
      tagIds.set(originTagName, configuredTagId);
      continue;
    }

    const knownTag = portalTagsByName.get(normalizeName(originTagName));

    if (knownTag?.id) {
      tagIds.set(originTagName, knownTag.id);
      continue;
    }

    if (!execute) {
      console.log(`Would create missing origin tag "${originTagName}" before creating QA tickets.`);
      tagIds.set(originTagName, null);
      continue;
    }

    const createdTag = await createPortalTag(config, accessToken, portalId, originTagName);
    tagIds.set(originTagName, createdTag.id);
    addKnownTag(portalTagsByName, createdTag);
    console.log(`Created missing origin tag "${originTagName}" (${createdTag.id}).`);
  }

  return tagIds;
}

function buildCreateTaskPayload({
  task,
  sourceBoard,
  originTagName,
  originTagId,
  qaTasklist,
  ownerId,
  includeRawTaskJson,
  maxRawTaskJsonChars
}) {
  const payload = {
    tasklist: { id: qaTasklist.id },
    name: getTaskName(task),
    description: buildQaDescription(task, sourceBoard, originTagName, includeRawTaskJson, maxRawTaskJsonChars)
  };

  if (ownerId) {
    // Confirmed against the live API (see updateTaskOwner): Zoho expects the person's
    // zpuid nested under owners_and_work.owners, not a bare owners: [{ id }] array.
    payload.owners_and_work = { owners: [{ zpuid: ownerId }] };
  }

  const tags = normalizeTags(task.tags);

  if (originTagId) {
    tags.push({ id: originTagId, name: originTagName });
  }

  const uniqueTags = dedupeTags(tags);

  if (uniqueTags.length > 0) {
    payload.tags = uniqueTags.map((tag) => ({ id: tag.id }));
  }

  return payload;
}

function buildQaDescription(task, sourceBoard, originTagName, includeRawTaskJson, maxRawTaskJsonChars) {
  const sourceKey = getSourceKey(sourceBoard, task);
  const originalDescription = String(task.description || "").trim() || "<p>No original description.</p>";
  const ownerNames = getOwnerNames(task).join(", ") || "Unassigned";
  const tagNames = normalizeTags(task.tags).map((tag) => tag.name).filter(Boolean).join(", ") || "None";
  const details = [
    ["Source board", sourceBoard.name],
    ["Source task ID", getTaskId(task)],
    ["Source task key", sourceKey],
    ["Source prefix", task.prefix],
    ["Source status", getStatusName(task)],
    ["Origin tag", originTagName],
    ["Priority", task.priority],
    ["Owners", ownerNames],
    ["Start date", task.start_date],
    ["End date", task.end_date],
    ["Duration", formatDuration(task.duration)],
    ["Completion", task.completion_percentage],
    ["Billing type", task.billing_type],
    ["Original tags", tagNames],
    ["Created time", task.created_time],
    ["Last modified time", task.last_modified_time],
    ["Source URL", getTaskUrl(task)]
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");

  const detailsHtml = details
    .map(([label, value]) => `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(String(value))}</li>`)
    .join("");
  const rawTaskHtml = includeRawTaskJson
    ? `<h4>Original task snapshot</h4><pre>${escapeHtml(truncateText(JSON.stringify(task, null, 2), maxRawTaskJsonChars))}</pre>`
    : "";

  return [
    "<div>",
    "<h3>Source DEV Board Task Details</h3>",
    `<ul>${detailsHtml}</ul>`,
    "<h4>Original description</h4>",
    originalDescription,
    rawTaskHtml,
    "</div>"
  ].join("");
}

async function createQaTask(config, accessToken, qaBoard, payload) {
  const response = await axios.post(
    `${config.zohoProjectsBaseUrl}/portal/${qaBoard.portalId}/projects/${qaBoard.projectId}/tasks`,
    payload,
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json"
      },
      timeout: 30000
    }
  );

  return response.data?.task || response.data?.data?.[0] || response.data?.data || response.data || {};
}

async function createPortalTag(config, accessToken, portalId, tagName) {
  try {
    return await createPortalTagWithParamName(config, accessToken, portalId, tagName, "\"tags\"");
  } catch (error) {
    if (isInvalidOAuthScope(error)) {
      throw new Error(
        `Cannot create missing tag "${tagName}". The refresh token needs ZohoProjects.tags.CREATE or set QA_DEV_${tagName.toUpperCase()}_TAG_ID to an existing tag ID. Zoho response: ${JSON.stringify(error.response.data)}`
      );
    }

    try {
      return await createPortalTagWithParamName(config, accessToken, portalId, tagName, "tags");
    } catch (retryError) {
      if (isInvalidOAuthScope(retryError)) {
        throw new Error(
          `Cannot create missing tag "${tagName}". The refresh token needs ZohoProjects.tags.CREATE or set QA_DEV_${tagName.toUpperCase()}_TAG_ID to an existing tag ID. Zoho response: ${JSON.stringify(retryError.response.data)}`
        );
      }

      throw retryError;
    }
  }
}

async function createPortalTagWithParamName(config, accessToken, portalId, tagName, paramName) {
  const response = await axios.post(`${config.zohoProjectsBaseUrl}/portal/${portalId}/tags`, null, {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`
    },
    params: {
      [paramName]: JSON.stringify([{ name: tagName, color_class: "#67a0ff" }])
    },
    timeout: 30000
  });

  const tags = response.data?.tags || response.data?.data || [];
  const createdTag = Array.isArray(tags) ? tags[0] : tags;

  if (!createdTag?.id) {
    throw new Error(`Tag creation response did not include an ID for "${tagName}": ${JSON.stringify(response.data)}`);
  }

  return { id: String(createdTag.id), name: String(createdTag.name || tagName) };
}

function printDryRunCreate(sourceBoard, task, payload, owner) {
  const tagIds = (payload.tags || []).map((tag) => tag.id).join(", ") || "none";
  console.log(`Would create QA task from ${sourceBoard.name}: ${getTaskName(task)}`);
  console.log(
    JSON.stringify(
      {
        sourceTaskId: getTaskId(task),
        sourceStatus: getStatusName(task),
        qaTaskName: payload.name,
        qaTasklistId: payload.tasklist.id,
        tagIds,
        owner: owner ? `${owner.name} (${owner.id})` : "none"
      },
      null,
      2
    )
  );
}

function isTargetStatusTask(task) {
  return TARGET_STATUS_KEYS.has(normalizeName(getStatusName(task)));
}

function buildExistingQaTaskIndex(qaTasks) {
  const index = {
    sourceKeys: new Set(),
    sourceTaskIds: new Set(),
    sourcePrefixes: new Set(),
    names: new Set()
  };

  const descriptionPatterns = [
    { field: "sourceKeys", pattern: /Source task key:<\/strong>\s*([^<]+)/gi },
    { field: "sourceTaskIds", pattern: /Source task ID:<\/strong>\s*([^<]+)/gi },
    { field: "sourcePrefixes", pattern: /Source prefix:<\/strong>\s*([^<]+)/gi }
  ];

  for (const task of qaTasks) {
    const taskName = normalizeName(getTaskName(task));

    if (taskName) {
      index.names.add(taskName);
    }

    const description = String(task.description || "");

    for (const { field, pattern } of descriptionPatterns) {
      pattern.lastIndex = 0;
      let match = pattern.exec(description);

      while (match) {
        index[field].add(normalizeName(decodeHtml(match[1])));
        match = pattern.exec(description);
      }
    }
  }

  return index;
}

function isAlreadyInQa(board, task, existingQaTaskIndex) {
  const sourceKey = normalizeName(getSourceKey(board, task));
  const sourceTaskId = normalizeName(getTaskId(task));
  const sourcePrefix = normalizeName(task.prefix);
  const taskName = normalizeName(getTaskName(task));

  return (
    (sourceKey && existingQaTaskIndex.sourceKeys.has(sourceKey)) ||
    (sourceTaskId && existingQaTaskIndex.sourceTaskIds.has(sourceTaskId)) ||
    (sourcePrefix && existingQaTaskIndex.sourcePrefixes.has(sourcePrefix)) ||
    (taskName && existingQaTaskIndex.names.has(taskName))
  );
}

function getSourceKey(board, task) {
  return `${board.portalId}:${board.projectId}:${getTaskId(task)}`;
}

function normalizeTags(tags = []) {
  return tags
    .map((tag) => ({
      id: String(tag.id || "").trim(),
      name: String(tag.name || "").trim()
    }))
    .filter((tag) => tag.id || tag.name);
}

function dedupeTags(tags) {
  const seen = new Set();
  const uniqueTags = [];

  for (const tag of tags) {
    const key = tag.id || normalizeName(tag.name);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueTags.push(tag);
  }

  return uniqueTags;
}

function addKnownTag(tagsByName, tag) {
  const normalizedTag = normalizeTags([tag])[0];

  if (!normalizedTag?.name || !normalizedTag.id) {
    return;
  }

  const key = normalizeName(normalizedTag.name);

  if (!tagsByName.has(key) || normalizedTag.name === key) {
    tagsByName.set(key, normalizedTag);
  }
}

function getOwnerNames(task) {
  const owners = task.owners_and_work?.owners || task.owners || [];

  if (!Array.isArray(owners)) {
    return [];
  }

  return owners.map((owner) => owner.name || owner.email || owner.zpuid || owner.zuid).filter(Boolean);
}

function getTaskUrl(task) {
  return String(task.web_url || task.webUrl || task.link || task.url || task.task_url || "");
}

function normalizePriority(priority) {
  const value = String(priority || "").trim().toLowerCase();
  return ["none", "low", "medium", "high"].includes(value) ? value : "";
}

function normalizeBillingType(billingType) {
  const value = String(billingType || "").trim().toLowerCase();
  return ["none", "billable", "non_billable"].includes(value) ? value : "";
}

function normalizeDuration(duration) {
  if (!duration || typeof duration !== "object") {
    return null;
  }

  const value = String(duration.value || "").trim();
  const unit = String(duration.unit || duration.type || "").trim().toLowerCase();

  if (!value || !["days", "hours"].includes(unit)) {
    return null;
  }

  return { value, unit };
}

function formatDuration(duration) {
  const normalizedDuration = normalizeDuration(duration);
  return normalizedDuration ? `${normalizedDuration.value} ${normalizedDuration.unit}` : "";
}

function copyIfPresent(target, key, value) {
  if (value !== undefined && value !== null && String(value).trim() !== "") {
    target[key] = value;
  }
}

function parseLimit(value) {
  if (value === "all") {
    return Number.POSITIVE_INFINITY;
  }

  const limit = Number.parseInt(value, 10);

  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("--limit-per-board must be a positive integer or all.");
  }

  return limit;
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function truncateText(value, maxLength) {
  if (!Number.isFinite(maxLength) || maxLength === 0 || value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}\n...truncated at ${maxLength} characters...`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function decodeHtml(value) {
  return String(value)
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

main().catch((error) => {
  console.error("QA dev-board task creation failed:", error.response?.data || error.message);
  process.exit(1);
});
