import axios from "axios";
import { getCliqMentionForBoard } from "./config.js";
import { getOwnerName, getTaskName, getTaskUrl } from "./task-normalizer.js";

const MAX_LISTED_TASKS_PER_PROJECT = 10;

export async function sendCliqNotification(config, board, notifications, targetStatusNames) {
  const mention = getCliqMentionForBoard(config, board);
  const statusCounts = countStatuses(notifications);
  const text = [
    formatDivider(),
    "🧪 *QA status update*",
    "",
    `*Project:* ${board.name}`,
    mention ? `*Assigned QA:* ${mention}` : null,
    "",
    "*Summary:*",
    `Statuses monitored: ${formatStatusList(targetStatusNames)}`,
    `New matching tasks: ${notifications.length}`,
    "Status breakdown:",
    formatStatusBreakdown(statusCounts),
    "",
    notifications.length > MAX_LISTED_TASKS_PER_PROJECT
      ? `This project has ${notifications.length} matching tasks, so task details were omitted to reduce message volume.`
      : formatTaskList(notifications),
    formatDivider()
  ]
    .filter(Boolean)
    .join("\n");

  await postCliqMessage(config, text);
}

export async function sendCliqHeartbeat(config, summary) {
  const text = [
    formatDivider(),
    "🫀 *QA status heartbeat*",
    "",
    `No new tasks entered ${formatStatusList(summary.targetStatusNames)} during this check.`,
    "",
    "*Summary:*",
    `Boards checked: ${summary.boardsChecked}`,
    `Tasks fetched: ${summary.tasksFetched}`,
    `Tasks currently in target status(es): ${summary.targetStatusTaskCount}`,
    `Previously notified issues: ${summary.previouslyNotifiedTaskCount}`,
    `Moved since last notification: ${summary.movedSinceLastNotificationCount}`,
    formatDivider()
  ].join("\n");

  await postCliqMessage(config, text);
}

async function postCliqMessage(config, text) {
  await axios.post(
    config.cliqWebhookUrl,
    { text },
    {
      headers: { "Content-Type": "application/json" },
      timeout: 30000
    }
  );
}

function formatStatusList(statusNames) {
  return statusNames.join(", ");
}

function countStatuses(notifications) {
  return notifications.reduce((counts, notification) => {
    counts[notification.statusName] = (counts[notification.statusName] || 0) + 1;
    return counts;
  }, {});
}

function formatStatusBreakdown(statusCounts) {
  return Object.entries(statusCounts)
    .sort(([leftStatus], [rightStatus]) => leftStatus.localeCompare(rightStatus))
    .map(([statusName, count]) => `- ${statusName}: ${count}`)
    .join("\n");
}

function formatTaskList(notifications) {
  const lines = ["*Tasks:*", ""];

  notifications.forEach((notification, index) => {
    const taskName = getTaskName(notification.task);
    const ownerName = getOwnerName(notification.task);
    const taskUrl = getTaskUrl(notification.task);
    lines.push(`${index + 1}. ${taskName}`);
    lines.push(`Status: ${notification.statusName}`);
    lines.push(`Owner: ${ownerName}`);

    if (taskUrl) {
      lines.push(`Link: ${taskUrl}`);
    }

    if (index < notifications.length - 1) {
      lines.push("");
    }
  });

  return lines.join("\n");
}

function formatDivider() {
  return "----------------------------------------";
}
