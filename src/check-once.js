import { getConfig, validateConfig } from "./config.js";
import { runNotifierCheck } from "./notifier.js";

async function main() {
  const config = getConfig();
  validateConfig(config);
  await runNotifierCheck(config);
}

main().catch((error) => {
  console.error("Check failed:", error.response?.data || error.message);
  process.exit(1);
});
