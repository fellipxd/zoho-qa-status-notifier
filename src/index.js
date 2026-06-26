import cron from "node-cron";
import { buildScheduleCronExpressions, getConfig, validateConfig } from "./config.js";
import { runNotifierCheck } from "./notifier.js";

async function main() {
  const config = getConfig();
  validateConfig(config);

  const scheduledExpressions = buildScheduleCronExpressions(config.scheduleTimes);

  if (scheduledExpressions.length > 0) {
    for (const cronExpression of scheduledExpressions) {
      cron.schedule(
        cronExpression,
        async () => {
          try {
            await runNotifierCheck(config);
          } catch (error) {
            console.error("Scheduled check failed:", error.response?.data || error.message);
          }
        },
        { timezone: config.scheduleTimezone }
      );
    }

    console.log(
      `Notifier scheduled daily at ${config.scheduleTimes.join(", ")} (${config.scheduleTimezone}). Press Ctrl+C to stop.`
    );
    return;
  }

  await runNotifierCheck(config);

  const cronExpression = `*/${config.pollIntervalMinutes} * * * *`;

  cron.schedule(cronExpression, async () => {
    try {
      await runNotifierCheck(config);
    } catch (error) {
      console.error("Scheduled check failed:", error.response?.data || error.message);
    }
  });

  console.log(`Notifier running every ${config.pollIntervalMinutes} minute(s). Press Ctrl+C to stop.`);
}

main().catch((error) => {
  console.error("Startup failed:", error.response?.data || error.message);
  process.exit(1);
});
