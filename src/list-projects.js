import { getConfig } from "./config.js";
import { getAccessToken, resolveProjectBoards } from "./zoho-projects-client.js";

async function main() {
  const config = getConfig();
  validateListProjectsConfig(config);

  console.log("Refreshing Zoho access token...");
  const accessToken = await getAccessToken(config);

  console.log("Resolving projects...");
  const boards = await resolveProjectBoards(config, accessToken);
  const rows = boards.map((board) => ({
    portalId: board.portalId,
    projectId: board.projectId,
    name: board.name
  }));

  console.log(`Resolved ${rows.length} project(s).`);
  console.table(rows);
  console.log(JSON.stringify(rows, null, 2));
}

function validateListProjectsConfig(config) {
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
    throw new Error(`Missing configuration for list-projects: ${missing.join(", ")}`);
  }
}

main().catch((error) => {
  console.error("Project listing failed:", error.response?.data || error.message);
  process.exit(1);
});
