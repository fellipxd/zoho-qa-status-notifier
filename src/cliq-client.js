import axios from "axios";
import { getOwnerName, getTaskName, getTaskUrl } from "./task-normalizer.js";

export async function sendCliqNotification(config, task, statusName, board) {
  const taskName = getTaskName(task);
  const ownerName = getOwnerName(task);
  const taskUrl = getTaskUrl(task);

  const text = [
    `🧪 *Task moved to ${statusName}*`,
    "",
    `*Board:* ${board.name}`,
    `*Task:* ${taskName}`,
    `*Owner:* ${ownerName}`,
    taskUrl ? `*Link:* ${taskUrl}` : null
  ]
    .filter(Boolean)
    .join("\n");

  await axios.post(
    config.cliqWebhookUrl,
    { text },
    {
      headers: { "Content-Type": "application/json" },
      timeout: 30000
    }
  );
}
