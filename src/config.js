import dotenv from "dotenv";

dotenv.config();

export function getConfig() {
  const monitorAllProjects = parseBoolean(process.env.MONITOR_ALL_PROJECTS || process.env.ZOHO_MONITOR_ALL_PROJECTS);
  const discoveryPortalIds = parseDiscoveryPortalIds(process.env);
  const projectBoards = monitorAllProjects ? [] : parseProjectBoards(process.env);
  const targetStatusNames = parseTargetStatusNames(process.env);

  const config = {
    zohoAccountsBaseUrl: process.env.ZOHO_ACCOUNTS_BASE_URL || "https://accounts.zoho.com",
    zohoProjectsBaseUrl: process.env.ZOHO_PROJECTS_BASE_URL || "https://projectsapi.zoho.com/api/v3",
    zohoClientId: process.env.ZOHO_CLIENT_ID,
    zohoClientSecret: process.env.ZOHO_CLIENT_SECRET,
    zohoRefreshToken: process.env.ZOHO_REFRESH_TOKEN,
    monitorAllProjects,
    discoveryPortalIds,
    projectBoards,
    targetStatusNames,
    targetStatusName: targetStatusNames[0],
    pollIntervalMinutes: Number.parseInt(process.env.POLL_INTERVAL_MINUTES || "5", 10),
    cliqWebhookUrl: process.env.CLIQ_WEBHOOK_URL,
    notifiedStateFile: process.env.NOTIFIED_STATE_FILE || "./data/notified.json",
    debugTasks: (process.env.DEBUG_TASKS || "false").toLowerCase() === "true"
  };

  return config;
}

export function validateConfig(config) {
  const required = {
    ZOHO_CLIENT_ID: config.zohoClientId,
    ZOHO_CLIENT_SECRET: config.zohoClientSecret,
    ZOHO_REFRESH_TOKEN: config.zohoRefreshToken,
    CLIQ_WEBHOOK_URL: config.cliqWebhookUrl
  };

  const missing = Object.entries(required)
    .filter(([, value]) => isMissingOrPlaceholder(value))
    .map(([key]) => key);

  const boardErrors = config.monitorAllProjects
    ? validateDiscoveryPortalIds(config.discoveryPortalIds)
    : validateProjectBoards(config.projectBoards);
  const statusErrors = validateTargetStatuses(config.targetStatusNames);

  if (missing.length > 0 || boardErrors.length > 0 || statusErrors.length > 0) {
    const messages = [];

    if (missing.length > 0) {
      messages.push(`Missing or placeholder environment variables: ${missing.join(", ")}`);
    }

    if (boardErrors.length > 0) {
      messages.push(`Invalid project board configuration: ${boardErrors.join("; ")}`);
    }

    if (statusErrors.length > 0) {
      messages.push(`Invalid target status configuration: ${statusErrors.join("; ")}`);
    }

    throw new Error(messages.join(". "));
  }

  if (!Number.isInteger(config.pollIntervalMinutes) || config.pollIntervalMinutes < 1) {
    throw new Error("POLL_INTERVAL_MINUTES must be a positive integer.");
  }
}

export function parseTargetStatusNames(env) {
  return splitList(env.TARGET_STATUS_NAMES || env.TARGET_STATUS_NAME || "QA");
}

export function parseDiscoveryPortalIds(env) {
  return splitList(env.ZOHO_PORTAL_IDS || env.ZOHO_PORTAL_ID);
}

export function parseProjectBoards(env) {
  const jsonConfig = env.ZOHO_PROJECTS_JSON || env.ZOHO_PROJECTS;

  if (jsonConfig) {
    let parsed;

    try {
      parsed = JSON.parse(jsonConfig);
    } catch (error) {
      throw new Error(`ZOHO_PROJECTS must be valid JSON: ${error.message}`);
    }

    if (!Array.isArray(parsed)) {
      throw new Error("ZOHO_PROJECTS must be a JSON array.");
    }

    return parsed.map((board, index) => normalizeProjectBoard(board, index));
  }

  const portalId = env.ZOHO_PORTAL_ID;
  const projectIds = splitList(env.ZOHO_PROJECT_IDS || env.ZOHO_PROJECT_ID);
  const projectNames = splitList(env.ZOHO_PROJECT_NAMES);

  return projectIds.map((projectId, index) =>
    normalizeProjectBoard(
      {
        portalId,
        projectId,
        name: projectNames[index]
      },
      index
    )
  );
}

function normalizeProjectBoard(board, index) {
  const portalId = String(board.portalId || board.portal_id || board.portal || "").trim();
  const projectId = String(board.projectId || board.project_id || board.id || "").trim();
  const name = String(board.name || board.label || (projectId ? `Project ${projectId}` : `Project ${index + 1}`)).trim();

  return {
    name,
    portalId,
    projectId
  };
}

function validateDiscoveryPortalIds(portalIds) {
  if (!Array.isArray(portalIds) || portalIds.length === 0) {
    return ["provide ZOHO_PORTAL_ID or ZOHO_PORTAL_IDS when MONITOR_ALL_PROJECTS=true"];
  }

  const errors = [];
  const seen = new Set();

  for (const portalId of portalIds) {
    if (isMissingOrPlaceholder(portalId)) {
      errors.push("portal IDs cannot be blank or placeholders");
      continue;
    }

    if (seen.has(portalId)) {
      errors.push(`${portalId} is duplicated`);
    }

    seen.add(portalId);
  }

  return errors;
}

function validateTargetStatuses(targetStatusNames) {
  if (!Array.isArray(targetStatusNames) || targetStatusNames.length === 0) {
    return ["provide TARGET_STATUS_NAMES or TARGET_STATUS_NAME"];
  }

  const errors = [];
  const seen = new Set();

  for (const statusName of targetStatusNames) {
    if (isMissingOrPlaceholder(statusName)) {
      errors.push("status names cannot be blank or placeholders");
      continue;
    }

    const key = statusName.toLowerCase();

    if (seen.has(key)) {
      errors.push(`${statusName} is duplicated`);
    }

    seen.add(key);
  }

  return errors;
}

function validateProjectBoards(projectBoards) {
  const errors = [];

  if (!Array.isArray(projectBoards) || projectBoards.length === 0) {
    return ["provide ZOHO_PROJECTS JSON or ZOHO_PORTAL_ID with ZOHO_PROJECT_ID/ZOHO_PROJECT_IDS"];
  }

  const seen = new Set();

  for (const [index, board] of projectBoards.entries()) {
    const label = board.name || `board ${index + 1}`;

    if (isMissingOrPlaceholder(board.portalId)) {
      errors.push(`${label} is missing portalId`);
    }

    if (isMissingOrPlaceholder(board.projectId)) {
      errors.push(`${label} is missing projectId`);
    }

    const key = `${board.portalId}:${board.projectId}`;

    if (seen.has(key)) {
      errors.push(`${label} duplicates portal/project ${key}`);
    }

    seen.add(key);
  }

  return errors;
}

function splitList(value = "") {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value = "") {
  return ["1", "true", "yes", "y", "on"].includes(String(value).trim().toLowerCase());
}

function isMissingOrPlaceholder(value) {
  return !value || String(value).includes("replace_with");
}
