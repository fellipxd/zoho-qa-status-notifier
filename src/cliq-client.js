import axios from "axios";
import { getCliqMentionForBoard } from "./config.js";
import { getOwnerName, getTaskName, getTaskUrl } from "./task-normalizer.js";

export async function sendCliqNotification(config, task, statusName, board) {
  const taskName = getTaskName(task);
  const ownerName = getOwnerName(task);
  const taskUrl = getTaskUrl(task);
  const mention = getCliqMentionForBoard(config, board);

  const text = [
    mention ? `${mention} 🧪 *Task moved to ${statusName}*` : `🧪 *Task moved to ${statusName}*`,
    "",
    `*Board:* ${board.name}`,
    `*Task:* ${taskName}`,
    `*Owner:* ${ownerName}`,
    taskUrl ? `*Link:* ${taskUrl}` : null
  ]
    .filter(Boolean)
    .join("\n");

  await postCliqMessage(config, text);
}

export async function sendCliqHeartbeat(config, summary) {
  const text = [
    "🫀 *QA status heartbeat*",
    "",
    `No new tasks entered ${formatStatusList(summary.targetStatusNames)} during this check.`,
    `*Boards checked:* ${summary.boardsChecked}`,
    `*Tasks fetched:* ${summary.tasksFetched}`,
    `*Tasks currently in target status(es):* ${summary.targetStatusTaskCount}`
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
