# Zoho QA Status Notifier

Polls one or more Zoho Projects boards/projects and sends a Zoho Cliq message when a task enters a configured status, for example `QA`, without using Zoho Projects Workflows.

## What this does

```text
Zoho Projects API
  -> scheduled Node.js poller
  -> optionally discovers all projects in the configured portal(s)
  -> detects task.status in TARGET_STATUS_NAMES
  -> sends Zoho Cliq webhook message
  -> stores notification state to prevent duplicates
```

## Requirements

- Node.js 18+
- Zoho account with access to the target Zoho Projects boards/tasks
- Zoho API client credentials
- Zoho refresh token
- Zoho Projects portal/project IDs for each board to monitor
- Zoho Cliq channel webhook URL

## 1. Install

```bash
npm install
```

## 2. Configure

Copy the example env file:

```bash
cp .env.example .env
```

Fill in `.env`:

```env
ZOHO_ACCOUNTS_BASE_URL=https://accounts.zoho.com
ZOHO_PROJECTS_BASE_URL=https://projectsapi.zoho.com/api/v3
ZOHO_CLIENT_ID=your_client_id
ZOHO_CLIENT_SECRET=your_client_secret
ZOHO_REFRESH_TOKEN=your_refresh_token
ZOHO_PORTAL_ID=your_portal_id
MONITOR_ALL_PROJECTS=true
TARGET_STATUS_NAMES=QA,UAT,Ready for Release
SCHEDULE_TIMES=09:00,16:30
SCHEDULE_TIMEZONE=Africa/Lagos
CLIQ_WEBHOOK_URL=https://cliq.zoho.com/api/v2/channelsbyname/your-channel/message?zapikey=your_token
NOTIFIED_STATE_FILE=./data/notified.json
DEBUG_TASKS=false
```

`SCHEDULE_TIMES` uses 24-hour `HH:MM` values separated by commas. When `SCHEDULE_TIMES` is set, the notifier runs only at those daily times in `SCHEDULE_TIMEZONE`.

If you prefer interval polling instead, leave `SCHEDULE_TIMES` blank and use:

```env
POLL_INTERVAL_MINUTES=5
```

With `MONITOR_ALL_PROJECTS=true`, the service discovers all accessible projects in `ZOHO_PORTAL_ID` and checks every discovered project each run.

If your Zoho account has multiple Projects portals to monitor, use:

```env
MONITOR_ALL_PROJECTS=true
ZOHO_PORTAL_IDS=portal_id_1,portal_id_2
```

If you only want selected boards under the same Zoho portal, leave `MONITOR_ALL_PROJECTS` unset or set it to `false`, then use comma-separated `ZOHO_PROJECT_IDS`:

```env
ZOHO_PORTAL_ID=your_portal_id
ZOHO_PROJECT_IDS=project_id_1,project_id_2
ZOHO_PROJECT_NAMES=Frontend Board,Backend Board
```

For boards across different Zoho portals, use `ZOHO_PROJECTS` JSON instead:

```env
ZOHO_PROJECTS=[{"name":"Frontend Board","portalId":"portal_1","projectId":"project_1"},{"name":"Backend Board","portalId":"portal_2","projectId":"project_2"}]
```

The old single-board and single-status format still works:

```env
ZOHO_PORTAL_ID=your_portal_id
ZOHO_PROJECT_ID=your_project_id
TARGET_STATUS_NAME=QA
```

Use the correct Zoho data center for your org. For example, if your Zoho account is on the EU data center, your base URLs may need `.eu` domains instead of `.com`.

## 3. Generate Zoho credentials

Create a self client in the Zoho API Console and generate a grant token with Projects read access.

Suggested scopes:

```text
ZohoProjects.projects.READ,ZohoProjects.tasks.READ
```

If your Zoho Projects API version does not accept `tasks.READ`, use:

```text
ZohoProjects.projects.READ,ZohoProjects.tasks.ALL
```

Exchange the grant token for a refresh token:

```bash
curl --request POST \
  'https://accounts.zoho.com/oauth/v2/token' \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode 'client_id=YOUR_CLIENT_ID' \
  --data-urlencode 'client_secret=YOUR_CLIENT_SECRET' \
  --data-urlencode 'code=YOUR_GRANT_TOKEN'
```

Save the returned `refresh_token` in `.env`.

## 4. Test your setup

Run:

```bash
npm run test-config
```

This checks:

1. Required env values exist.
2. Zoho OAuth token refresh works.
3. Zoho Projects discovery works when `MONITOR_ALL_PROJECTS=true`.
4. Zoho Projects task read access works for every resolved board.
5. Zoho Cliq webhook posting works.

## 4a. List all projects

Run:

```bash
npm run list-projects
```

This prints every resolved project with its `portalId`, `projectId`, and `name`. Use those IDs when creating per-project Cliq mention mappings.

## 4b. Attach a Cliq user to a project

Add `PROJECT_CLIQ_MENTIONS` in `.env` as JSON:

```env
PROJECT_CLIQ_MENTIONS=[{"portalId":"915071504","projectId":"2637801000000347665","cliqUserEmail":"qa.lead@yourcompany.com"},{"portalId":"915071504","projectId":"2637801000000380006","cliqUserZohoId":"60040396507"}]
```

Each mapping must include:

- `portalId`
- `projectId`
- exactly one of `cliqUserEmail` or `cliqUserZohoId`

When a task in that project enters one of the configured statuses, the notifier prefixes the Cliq message with that user's mention.

## 5. Run one check manually

```bash
npm run check
```

This fetches tasks once from every configured or discovered board and sends notifications for any task currently in `TARGET_STATUS_NAMES` that has not already been notified.

If no new matching tasks are found for the whole run, it sends a quiet heartbeat message to Cliq instead.

## 6. Run continuously

```bash
npm start
```

If `SCHEDULE_TIMES` is set, the notifier will run at those daily times in `SCHEDULE_TIMEZONE`.

If `SCHEDULE_TIMES` is not set, the notifier will run immediately, then repeat every `POLL_INTERVAL_MINUTES` minutes.

## Duplicate notification rule

The notifier stores state in:

```text
./data/notified.json
```

It sends only once for each:

```text
portalId + projectId + taskId + statusName
```

So a task already in `QA` will not spam the Cliq channel on repeated scheduled checks, but that same task can still notify separately if it later matches another configured status such as `UAT`. Two boards with the same task ID do not suppress each other.

When a run sends `0` new notifications, the notifier posts a heartbeat summary to Cliq so the channel still shows that the check ran successfully.

## Debugging task status fields

Zoho Projects responses can differ by account/API version. If the script does not recognize the status correctly, set:

```env
DEBUG_TASKS=true
```

Then run:

```bash
npm run check
```

The script will print normalized samples like:

```json
{
  "board": "Frontend Board",
  "id": "123",
  "name": "Example task",
  "status": "QA",
  "owner": "Unassigned",
  "url": ""
}
```

If status is blank or wrong, inspect the raw Zoho response and update `src/task-normalizer.js`.

## Deployment option: PM2 on a server

```bash
npm install -g pm2
pm2 start src/index.js --name zoho-qa-status-notifier
pm2 save
pm2 startup
```

## Deployment option: GitHub Actions

This repo includes [`.github/workflows/notifier.yml`](/mnt/c/Users/phili/Desktop/pandora/zoho-qa-status-notifier/zoho-qa-status-notifier/.github/workflows/notifier.yml), which runs:

- At `08:00 UTC` daily
- At `15:30 UTC` daily
- Manually through `workflow_dispatch`

Those UTC times match `09:00` and `16:30` in `Africa/Lagos`.

Set these GitHub repository secrets:

- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REFRESH_TOKEN`
- `CLIQ_WEBHOOK_URL`

Set these GitHub repository variables as needed:

- `ZOHO_PORTAL_ID` or `ZOHO_PORTAL_IDS`
- `MONITOR_ALL_PROJECTS`
- `ZOHO_PROJECT_IDS`
- `ZOHO_PROJECT_NAMES`
- `ZOHO_PROJECTS`
- `TARGET_STATUS_NAMES`
- `TARGET_STATUS_NAME`
- `PROJECT_CLIQ_MENTIONS`
- `DEBUG_TASKS`
- `ZOHO_ACCOUNTS_BASE_URL` if not using `https://accounts.zoho.com`
- `ZOHO_PROJECTS_BASE_URL` if not using `https://projectsapi.zoho.com/api/v3`

The workflow stores duplicate-notification state in [`.github/notifier-state/notified.json`](/mnt/c/Users/phili/Desktop/pandora/zoho-qa-status-notifier/zoho-qa-status-notifier/.github/notifier-state/notified.json) and commits updates back to the repository after each run.

## Production recommendation

For production, replace the JSON file state store with a persistent database table if running in an environment where local files can be deleted between deployments.

Suggested table:

```sql
CREATE TABLE zoho_task_notifications (
  id SERIAL PRIMARY KEY,
  portal_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  status_name TEXT NOT NULL,
  task_name TEXT,
  notified_at TIMESTAMP NOT NULL,
  UNIQUE(portal_id, project_id, task_id, status_name)
);
```

## Security notes

- Do not commit `.env`.
- Use a service/automation Zoho user if possible.
- Give the Zoho user only the minimum required project/task access.
- Rotate tokens if credentials are exposed.
