import dotenv from "dotenv";

dotenv.config();

export function getConfig() {
  const monitorAllProjects = parseBoolean(process.env.MONITOR_ALL_PROJECTS || process.env.ZOHO_MONITOR_ALL_PROJECTS);
  const discoveryPortalIds = parseDiscoveryPortalIds(process.env);
  const projectBoards = monitorAllProjects ? [] : parseProjectBoards(process.env);
  const targetStatusNames = parseTargetStatusNames(process.env);
  const scheduleTimes = parseScheduleTimes(process.env);
  const projectCliqMentions = parseProjectCliqMentions(process.env);

  const config = {
    zohoAccountsBaseUrl: process.env.ZOHO_ACCOUNTS_BASE_URL || "https://accounts.zoho.com",
    zohoProjectsBaseUrl: process.env.ZOHO_PROJECTS_BASE_URL || "https://projectsapi.zoho.com/api/v3",
    zohoClientId: process.env.ZOHO_CLIENT_ID,
    zohoClientSecret: process.env.ZOHO_CLIENT_SECRET,
    zohoRefreshToken: process.env.ZOHO_REFRESH_TOKEN,
    monitorAllProjects,
    discoveryPortalIds,
    projectBoards,
    projectCliqMentions,
    targetStatusNames,
    targetStatusName: targetStatusNames[0],
    scheduleTimes,
    scheduleTimezone:
      process.env.SCHEDULE_TIMEZONE || process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
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
  const projectCliqMentionErrors = validateProjectCliqMentions(config.projectCliqMentions);

  if (missing.length > 0 || boardErrors.length > 0 || statusErrors.length > 0 || projectCliqMentionErrors.length > 0) {
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

    if (projectCliqMentionErrors.length > 0) {
      messages.push(`Invalid project Cliq mention configuration: ${projectCliqMentionErrors.join("; ")}`);
    }

    throw new Error(messages.join(". "));
  }

  if (config.scheduleTimes.length > 0) {
    validateScheduleTimes(config.scheduleTimes);
    return;
  }

  if (!Number.isInteger(config.pollIntervalMinutes) || config.pollIntervalMinutes < 1) {
    throw new Error("POLL_INTERVAL_MINUTES must be a positive integer.");
  }
}

export function buildScheduleCronExpressions(scheduleTimes) {
  return scheduleTimes.map((time) => {
    const [hour, minute] = time.split(":");
    return `${minute} ${hour} * * *`;
  });
}

export function getCliqMentionForBoard(config, board) {
  const mapping = config.projectCliqMentions.find(
    (entry) => entry.portalId === board.portalId && entry.projectId === board.projectId
  );

  if (!mapping) {
    return null;
  }

  if (mapping.cliqUserZohoId) {
    return `{@${mapping.cliqUserZohoId}}`;
  }

  if (mapping.cliqUserEmail) {
    return `{@${mapping.cliqUserEmail}}`;
  }

  return null;
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

export function parseScheduleTimes(env) {
  return splitList(env.SCHEDULE_TIMES || env.SCHEDULE_TIME);
}

export function parseProjectCliqMentions(env) {
  const raw = env.PROJECT_CLIQ_MENTIONS;

  if (!raw) {
    return [];
  }

  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`PROJECT_CLIQ_MENTIONS must be valid JSON: ${error.message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("PROJECT_CLIQ_MENTIONS must be a JSON array.");
  }

  return parsed.map((entry, index) => normalizeProjectCliqMention(entry, index));
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

function normalizeProjectCliqMention(entry, index) {
  const portalId = String(entry.portalId || entry.portal_id || entry.portal || "").trim();
  const projectId = String(entry.projectId || entry.project_id || entry.id || "").trim();
  const cliqUserZohoId = String(entry.cliqUserZohoId || entry.zohoId || entry.userZohoId || "").trim();
  const cliqUserEmail = String(entry.cliqUserEmail || entry.email || entry.userEmail || "").trim();

  return {
    portalId,
    projectId,
    cliqUserZohoId,
    cliqUserEmail,
    label: String(entry.label || entry.name || `mapping ${index + 1}`).trim()
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

function validateProjectCliqMentions(projectCliqMentions) {
  if (!Array.isArray(projectCliqMentions) || projectCliqMentions.length === 0) {
    return [];
  }

  const errors = [];
  const seen = new Set();

  for (const mapping of projectCliqMentions) {
    const label = mapping.label || `${mapping.portalId}:${mapping.projectId}`;

    if (isMissingOrPlaceholder(mapping.portalId)) {
      errors.push(`${label} is missing portalId`);
    }

    if (isMissingOrPlaceholder(mapping.projectId)) {
      errors.push(`${label} is missing projectId`);
    }

    if (!mapping.cliqUserZohoId && !mapping.cliqUserEmail) {
      errors.push(`${label} must include cliqUserZohoId or cliqUserEmail`);
    }

    if (mapping.cliqUserZohoId && mapping.cliqUserEmail) {
      errors.push(`${label} must include only one of cliqUserZohoId or cliqUserEmail`);
    }

    const key = `${mapping.portalId}:${mapping.projectId}`;
    if (seen.has(key)) {
      errors.push(`${label} duplicates project mapping for ${key}`);
    }
    seen.add(key);
  }

  return errors;
}

function validateScheduleTimes(scheduleTimes) {
  const errors = [];
  const seen = new Set();

  for (const scheduleTime of scheduleTimes) {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(scheduleTime)) {
      errors.push(`${scheduleTime} must use 24-hour HH:MM format`);
      continue;
    }

    if (seen.has(scheduleTime)) {
      errors.push(`${scheduleTime} is duplicated`);
    }

    seen.add(scheduleTime);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid schedule time configuration: ${errors.join("; ")}`);
  }
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
