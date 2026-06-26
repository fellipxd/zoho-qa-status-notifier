import axios from "axios";
import { getConfig, validateConfig } from "./config.js";
import { getAccessToken, fetchTasksPage, resolveProjectBoards } from "./zoho-projects-client.js";
import { taskSummary } from "./task-normalizer.js";

async function main() {
  const config = getConfig();
  validateConfig(config);

  console.log("Configuration looks complete.");
  console.log("Testing Zoho OAuth token refresh...");
  const accessToken = await getAccessToken(config);
  console.log("Zoho OAuth token refresh succeeded.");

  console.log("Resolving Zoho Projects boards...");
  const boards = await resolveProjectBoards(config, accessToken);
  console.log(`Resolved ${boards.length} board(s).`);

  console.log(`Testing Zoho Projects task read access for ${boards.length} board(s)...`);

  for (const board of boards) {
    const { tasks } = await fetchTasksPage(config, accessToken, board, 1);
    console.log(
      `Zoho Projects task read succeeded for ${board.name}. Received ${tasks.length} task(s) on page 1.`
    );

    if (tasks.length > 0) {
      console.log("Sample normalized task:");
      console.log(JSON.stringify({ board: board.name, ...taskSummary(tasks[0]) }, null, 2));
    }
  }

  console.log("Testing Zoho Cliq webhook...");
  await axios.post(
    config.cliqWebhookUrl,
    { text: "✅ QA Status Notifier test message. If you can see this, Cliq posting works." },
    { headers: { "Content-Type": "application/json" }, timeout: 30000 }
  );
  console.log("Zoho Cliq webhook test succeeded.");
}

main().catch((error) => {
  console.error("Config test failed:", error.response?.data || error.message);
  process.exit(1);
});
