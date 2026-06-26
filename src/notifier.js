import { sendCliqNotification } from "./cliq-client.js";
import { loadState, saveState } from "./state-store.js";
import { getAccessToken, fetchAllTasks } from "./zoho-projects-client.js";
import { getStatusName, getTaskId, getTaskName, taskSummary } from "./task-normalizer.js";

export async function runNotifierCheck(config) {
  const targetStatusKeys = new Set(config.targetStatusNames.map((statusName) => normalizeStatusKey(statusName)));
  const projectScope = config.monitorAllProjects
    ? `all projects in ${config.discoveryPortalIds.length} portal(s)`
    : `${config.projectBoards.length} configured board(s)`;

  console.log(
    `[${new Date().toISOString()}] Checking Zoho Projects tasks across ${projectScope} for status(es): ${formatStatusList(config.targetStatusNames)}...`
  );

  const accessToken = await getAccessToken(config);
  const taskGroups = await fetchAllTasks(config, accessToken);
  const state = loadState(config.notifiedStateFile);

  let tasksFetched = 0;
  let notificationsSent = 0;
  let targetStatusTaskCount = 0;

  for (const { board, tasks } of taskGroups) {
    tasksFetched += tasks.length;

    if (config.debugTasks) {
      console.log(`Fetched tasks for ${getBoardLabel(board)}:`);
      for (const task of tasks.slice(0, 20)) {
        console.log(JSON.stringify({ board: board.name, ...taskSummary(task) }, null, 2));
      }
      if (tasks.length > 20) {
        console.log(`...${tasks.length - 20} more task(s) not shown for ${getBoardLabel(board)}.`);
      }
    }

    for (const task of tasks) {
      const taskId = getTaskId(task);
      const statusName = getStatusName(task).trim();

      if (!taskId || !statusName) {
        continue;
      }

      const boardTaskKey = getBoardTaskKey(board, taskId);

      state.lastSeenStatusByTask[boardTaskKey] = {
        boardName: board.name,
        portalId: board.portalId,
        projectId: board.projectId,
        taskId,
        statusName,
        taskName: getTaskName(task),
        seenAt: new Date().toISOString()
      };

      const statusKey = normalizeStatusKey(statusName);
      const isTargetStatus = targetStatusKeys.has(statusKey);

      if (!isTargetStatus) {
        continue;
      }

      targetStatusTaskCount += 1;

      const notificationKey = `${boardTaskKey}:${statusKey}`;
      const legacyNotificationKey = `${taskId}:${statusKey}`;
      const legacyNotified =
        config.projectBoards.length === 1 && state.notified[legacyNotificationKey];

      if (state.notified[notificationKey] || legacyNotified) {
        if (!state.notified[notificationKey] && legacyNotified) {
          state.notified[notificationKey] = {
            ...legacyNotified,
            boardName: board.name,
            portalId: board.portalId,
            projectId: board.projectId,
            migratedFromLegacyKey: legacyNotificationKey
          };
        }
        continue;
      }

      await sendCliqNotification(config, task, statusName, board);

      state.notified[notificationKey] = {
        boardName: board.name,
        portalId: board.portalId,
        projectId: board.projectId,
        taskId,
        statusName,
        taskName: getTaskName(task),
        notifiedAt: new Date().toISOString()
      };

      notificationsSent += 1;
    }
  }

  saveState(config.notifiedStateFile, state);

  console.log(
    `[${new Date().toISOString()}] Done. Checked ${taskGroups.length} board(s), fetched ${tasksFetched} task(s), found ${targetStatusTaskCount} task(s) in ${formatStatusList(config.targetStatusNames)}, sent ${notificationsSent} notification(s).`
  );

  return {
    boardsChecked: taskGroups.length,
    tasksFetched,
    targetStatusTaskCount,
    notificationsSent
  };
}

function normalizeStatusKey(statusName) {
  return statusName.trim().toLowerCase();
}

function formatStatusList(statusNames) {
  return statusNames.join(", ");
}

function getBoardTaskKey(board, taskId) {
  return `${board.portalId}:${board.projectId}:${taskId}`;
}

function getBoardLabel(board) {
  return `${board.name} (${board.portalId}/${board.projectId})`;
}
