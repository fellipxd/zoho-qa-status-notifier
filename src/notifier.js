import { sendCliqHeartbeat, sendCliqNotification } from "./cliq-client.js";
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
  const latestNotifiedByTask = buildLatestNotifiedByTask(state.notified);

  let tasksFetched = 0;
  let notificationsSent = 0;
  let tasksNotified = 0;
  const currentTargetStatusTaskKeys = new Set();
  const previouslyNotifiedTaskKeys = new Set();
  const movedSinceLastNotificationTaskKeys = new Set();

  for (const { board, tasks } of taskGroups) {
    tasksFetched += tasks.length;
    const pendingNotifications = [];
    const pendingStateEntries = [];

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
      const statusKey = normalizeStatusKey(statusName);
      const latestNotification = latestNotifiedByTask[boardTaskKey];

      if (latestNotification) {
        previouslyNotifiedTaskKeys.add(boardTaskKey);

        if (normalizeStatusKey(latestNotification.statusName) !== statusKey) {
          movedSinceLastNotificationTaskKeys.add(boardTaskKey);
        }
      }

      state.lastSeenStatusByTask[boardTaskKey] = {
        boardName: board.name,
        portalId: board.portalId,
        projectId: board.projectId,
        taskId,
        statusName,
        taskName: getTaskName(task),
        seenAt: new Date().toISOString()
      };

      const isTargetStatus = targetStatusKeys.has(statusKey);

      if (!isTargetStatus) {
        continue;
      }

      currentTargetStatusTaskKeys.add(boardTaskKey);

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

      pendingNotifications.push({ task, statusName });
      pendingStateEntries.push({
        notificationKey,
        value: {
          boardName: board.name,
          portalId: board.portalId,
          projectId: board.projectId,
          taskId,
          statusName,
          taskName: getTaskName(task),
          notifiedAt: new Date().toISOString()
        }
      });
    }

    if (pendingNotifications.length > 0) {
      await sendCliqNotification(config, board, pendingNotifications, config.targetStatusNames);

      for (const entry of pendingStateEntries) {
        state.notified[entry.notificationKey] = entry.value;
      }

      saveState(config.notifiedStateFile, state);

      notificationsSent += 1;
      tasksNotified += pendingNotifications.length;
    }
  }

  saveState(config.notifiedStateFile, state);

  if (notificationsSent === 0) {
    await sendCliqHeartbeat(config, {
      boardsChecked: taskGroups.length,
      tasksFetched,
      targetStatusTaskCount: currentTargetStatusTaskKeys.size,
      targetStatusNames: config.targetStatusNames,
      previouslyNotifiedTaskCount: previouslyNotifiedTaskKeys.size,
      movedSinceLastNotificationCount: movedSinceLastNotificationTaskKeys.size
    });
  }

  console.log(
    `[${new Date().toISOString()}] Done. Checked ${taskGroups.length} board(s), fetched ${tasksFetched} task(s), found ${currentTargetStatusTaskKeys.size} current task(s) in ${formatStatusList(config.targetStatusNames)}, sent ${notificationsSent} Cliq message(s) for ${tasksNotified} new task(s).`
  );

  return {
    boardsChecked: taskGroups.length,
    tasksFetched,
    targetStatusTaskCount: currentTargetStatusTaskKeys.size,
    notificationsSent,
    tasksNotified,
    previouslyNotifiedTaskCount: previouslyNotifiedTaskKeys.size,
    movedSinceLastNotificationCount: movedSinceLastNotificationTaskKeys.size
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

function buildLatestNotifiedByTask(notifiedState) {
  const latestByTask = {};

  for (const entry of Object.values(notifiedState || {})) {
    if (!entry?.portalId || !entry?.projectId || !entry?.taskId) {
      continue;
    }

    const boardTaskKey = `${entry.portalId}:${entry.projectId}:${entry.taskId}`;
    const existingEntry = latestByTask[boardTaskKey];

    if (!existingEntry) {
      latestByTask[boardTaskKey] = entry;
      continue;
    }

    const existingTime = Date.parse(existingEntry.notifiedAt || 0);
    const candidateTime = Date.parse(entry.notifiedAt || 0);

    if (candidateTime >= existingTime) {
      latestByTask[boardTaskKey] = entry;
    }
  }

  return latestByTask;
}
