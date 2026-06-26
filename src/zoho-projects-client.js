import axios from "axios";

export async function getAccessToken(config) {
  const response = await axios.post(`${config.zohoAccountsBaseUrl}/oauth/v2/token`, null, {
    params: {
      grant_type: "refresh_token",
      client_id: config.zohoClientId,
      client_secret: config.zohoClientSecret,
      refresh_token: config.zohoRefreshToken
    },
    timeout: 30000
  });

  if (!response.data?.access_token) {
    throw new Error(`Zoho token response did not contain an access_token: ${JSON.stringify(response.data)}`);
  }

  return response.data.access_token;
}

export async function fetchTasksPage(config, accessToken, board, page = 1) {
  const url = `${config.zohoProjectsBaseUrl}/portal/${board.portalId}/projects/${board.projectId}/tasks`;

  const response = await axios.get(url, {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`
    },
    params: {
      page,
      per_page: 100
    },
    timeout: 30000
  });

  const body = response.data || {};
  const tasks = body.tasks || body.data || body.task || [];
  const normalizedTasks = Array.isArray(tasks) ? tasks : [tasks].filter(Boolean);

  const hasMore = hasMoreRecords(body);

  return { tasks: normalizedTasks, hasMore, raw: body };
}

export async function fetchAllTasks(config, accessToken) {
  const boards = await resolveProjectBoards(config, accessToken);
  const taskGroups = [];

  for (const board of boards) {
    const tasks = await fetchAllTasksForBoard(config, accessToken, board);
    taskGroups.push({ board, tasks });
  }

  return taskGroups;
}

export async function fetchAllTasksForBoard(config, accessToken, board) {
  let page = 1;
  const allTasks = [];

  while (true) {
    const { tasks, hasMore } = await fetchTasksPage(config, accessToken, board, page);
    allTasks.push(...tasks);

    if (!hasMore || tasks.length === 0) {
      break;
    }

    page += 1;
  }

  return allTasks;
}

export async function resolveProjectBoards(config, accessToken) {
  if (!config.monitorAllProjects) {
    return config.projectBoards;
  }

  const boards = [];

  for (const portalId of config.discoveryPortalIds) {
    boards.push(...(await fetchAllProjectsForPortal(config, accessToken, portalId)));
  }

  if (boards.length === 0) {
    throw new Error(`No projects were discovered for portal(s): ${config.discoveryPortalIds.join(", ")}`);
  }

  return boards;
}

export async function fetchProjectsPage(config, accessToken, portalId, page = 1) {
  const url = `${config.zohoProjectsBaseUrl}/portal/${portalId}/projects`;

  const response = await axios.get(url, {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`
    },
    params: {
      page,
      per_page: 100
    },
    timeout: 30000
  });

  const body = response.data || {};
  const projects = extractProjects(body);

  return {
    projects: projects
      .map((project, index) => normalizeProjectBoard(project, portalId, index))
      .filter((board) => board.projectId),
    hasMore: hasMoreRecords(body),
    raw: body
  };
}

export async function fetchAllProjectsForPortal(config, accessToken, portalId) {
  let page = 1;
  const projects = [];

  while (true) {
    const { projects: pageProjects, hasMore } = await fetchProjectsPage(config, accessToken, portalId, page);
    projects.push(...pageProjects);

    if (!hasMore || pageProjects.length === 0) {
      break;
    }

    page += 1;
  }

  return projects;
}

function extractProjects(body) {
  const candidates = [
    body,
    body.projects,
    body.project,
    body.data?.projects,
    body.data?.project,
    body.data?.[0]?.entities,
    body.data,
    body.entities
  ];

  const projects = candidates.find((candidate) => {
    if (Array.isArray(candidate)) {
      return candidate.length > 0;
    }

    return Boolean(candidate);
  }) || [];

  return Array.isArray(projects) ? projects : [projects].filter(Boolean);
}

function normalizeProjectBoard(project, portalId, index) {
  const projectId = String(
    project.id ||
    project.id_string ||
    project.project_id ||
    project.projectId ||
    project.key ||
    ""
  ).trim();

  const name = String(
    project.name ||
    project.project_name ||
    project.projectName ||
    project.title ||
    (projectId ? `Project ${projectId}` : `Project ${index + 1}`)
  ).trim();

  return {
    name,
    portalId,
    projectId
  };
}

function hasMoreRecords(body) {
  if (Array.isArray(body)) {
    return body.length === 100;
  }

  return Boolean(
    body.next_page ||
    body.has_more ||
    body.pagination?.has_more ||
    body.pagination?.has_next_page ||
    body.info?.more_records ||
    body.page_context?.has_more_page ||
    body.page_info?.has_next_page
  );
}
