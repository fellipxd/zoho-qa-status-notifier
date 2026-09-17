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

An optional `tag` field on a mapping also lets the [QA dev-board task creation script](#assigning-an-owner-to-each-new-qa-ticket) assign that same person as the owner of any migrated QA task whose source task carries a matching project tag.

For a long list of mappings, keeping everything on one `PROJECT_CLIQ_MENTIONS` line gets hard to read and edit. Put it in its own formatted JSON file instead and point to it:

```env
PROJECT_CLIQ_MENTIONS_FILE=./project-cliq-mentions.json
```

See `project-cliq-mentions.example.json` for the format — same shape as the inline JSON array, just multi-line. `PROJECT_CLIQ_MENTIONS_FILE` takes precedence over `PROJECT_CLIQ_MENTIONS` when both are set. Keep the file out of version control (it holds real emails/IDs), the same as `.env`.

## 5. Run one check manually

```bash
npm run check
```

This fetches tasks once from every configured or discovered board and sends notifications for any task currently in `TARGET_STATUS_NAMES` that has not already been notified.

Notifications are batched per project. If a project has `10` or fewer new matching tasks, the Cliq message lists them. If a project has more than `10`, the message shows the total count and a status breakdown instead of listing every task.

If no new matching tasks are found for the whole run, it sends a quiet heartbeat message to Cliq instead.

## 5a. One-time QA dev-board task creation

Run the manual migration script when you want to create QA-board tickets from DEV-board tasks in `Testing` or `Pushed To QA` status:

```bash
npm run create-qa-dev-tasks
```

By default this is a dry run. It checks `FRONTEND TASK BOARD` and `BACKEND TASK BOARD`, selects one matching task from each board, and reports what would be created on `QA TASK BOARD` under `Task from DEV Board`.

To create only the first matching frontend task and first matching backend task for verification:

```bash
npm run create-qa-dev-tasks -- --execute
```

After those two are verified, create the remaining matching tasks:

```bash
npm run create-qa-dev-tasks -- --execute --all
```

The script creates each QA ticket with the original task name, a rich description containing the source task details, and the original tag IDs. It also adds the origin tag `FRONTEND` or `BACKEND`. It skips tasks already present on the QA board by checking source metadata written by this script and existing QA task names, source IDs, and source prefixes.

The description no longer includes a full raw JSON snapshot of the source task by default (it was mostly noise). Pass `--include-raw-json` if you need it back for a specific run.

### Assigning an owner to each new QA ticket

Each DEV-board task carries a project tag (for example `WDS`, `TRADEX`, `COTEX2.0`) identifying which client project it belongs to. The script resolves that tag to an owner using the `tag` field on your existing `PROJECT_CLIQ_MENTIONS` entries, and assigns the matched person as the new QA task's owner (in addition to their existing use as the Cliq mention target):

```env
PROJECT_CLIQ_MENTIONS=[{"portalId":"915071504","projectId":"2637801000000182317","name":"Wells and Drilling Services (WDS)","tag":"WDS","cliqUserEmail":"chisom.okpalaeke@brandonetech.com"}]
```

Add a `tag` value to each entry that should drive QA task ownership; entries without a `tag` are ignored for this purpose. Since the same project is often tagged inconsistently on DEV-board tasks (typos, renames, a `PORTAL`/`2.0` suffix sometimes added), `tag` also accepts a comma-separated list or a JSON array so one entry can cover every spelling in use, e.g. `"tag":"AGS,AGS PORTAL,AGS STAGING"`. If a task's tags don't match any configured `tag`, it falls back to:

```env
QA_DEV_DEFAULT_OWNER_EMAIL=qa.lead@brandonetech.com
```

If a task matches more than one `tag` mapped to *different* owners, the script logs a warning and creates the task unassigned rather than guessing. If an owner's email isn't found among the QA board's members, or two `PROJECT_CLIQ_MENTIONS` entries map the same `tag` to different emails, the script also warns/errors accordingly instead of silently assigning the wrong person.

Resolving an email to a Zoho user requires reading the QA board's member list, which needs `ZohoProjects.users.READ` on the refresh token. If that scope is missing, the script logs a warning once and creates every task unassigned instead of failing the whole run.

Optional overrides:

```env
QA_DEV_QA_PROJECT_ID=2637801000000246021
QA_DEV_TASKLIST_ID=2637801000000468022
QA_DEV_FRONTEND_PROJECT_ID=2637801000000347082
QA_DEV_BACKEND_PROJECT_ID=2637801000000347665
QA_DEV_FRONTEND_TAG_ID=existing_frontend_tag_id
QA_DEV_BACKEND_TAG_ID=existing_backend_tag_id
QA_DEV_DEFAULT_OWNER_EMAIL=qa.lead@brandonetech.com
```

The refresh token needs `ZohoProjects.projects.READ`, `ZohoProjects.tasks.READ`, and `ZohoProjects.tasks.CREATE`. If the `FRONTEND` or `BACKEND` tag does not already exist, it also needs `ZohoProjects.tags.CREATE`, or you can set `QA_DEV_FRONTEND_TAG_ID` / `QA_DEV_BACKEND_TAG_ID` to existing tag IDs. To assign owners, it also needs `ZohoProjects.users.READ`.

## 5b. Backfill or resync owners on already-created QA tickets

Use this any time you want existing QA tickets to match your current `PROJECT_CLIQ_MENTIONS` tag mapping — whether that's backfilling owners on tickets created before owner assignment existed, or picking up a change you just made to `cliqUserEmail` for a project. It keeps the board's owners in sync with the mapping: unassigned tickets get assigned, and tickets whose current owner doesn't match the mapping get reassigned. A ticket already showing the correct owner is left untouched (no-op), so it's safe to run repeatedly.

```bash
npm run assign-qa-task-owners
```

By default this is a dry run scoped to the `Task from DEV Board` task list on `QA TASK BOARD`. To apply it for real:

```bash
npm run assign-qa-task-owners -- --execute
```

Useful flags:

- `--limit=N` — only update the first `N` tasks that need a change, to spot-check before running against everything.
- `--skip-assigned` — don't touch a task that already has a different owner set; only fill in ones that are currently unassigned. Use this if you want to preserve owners set manually and only rely on the mapping for new/blank tickets.
- `--all-tasklists` — scan every task list on the QA board instead of just `Task from DEV Board`.

It resolves each existing ticket's owner from its own tags (the tags were copied over when the ticket was created), so no source-board lookup is needed. Tasks with no matching tag, an unresolved owner email, or tags that match more than one owner are left untouched and logged, the same as during creation.

This needs the same `ZohoProjects.users.READ` scope as owner assignment during creation, plus a scope that allows updating a task's owner (`ZohoProjects.tasks.UPDATE`, or whatever your account calls it) — Zoho's exact update endpoint isn't documented consistently across accounts, so the script tries a couple of HTTP methods automatically and reports if none of them work.

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

This repo includes [`.github/workflows/notifier.yml`](/mnt/c/Users/phili/Desktop/pandora/zoho-qa-status-notifier/zoho-qa-status-notifier/.github/workflows/notifier.yml), which runs, at `08:00 UTC` and `15:30 UTC` daily (matching `09:00`/`16:30` `Africa/Lagos`) and on manual `workflow_dispatch`:

1. **The Cliq status notifier** (`npm run check`) — same as running it locally.
2. **The QA dev-board task creation script** (`npm run create-qa-dev-tasks -- --execute --all`) — creates QA tickets for every newly-qualifying DEV-board task, every run. This is safe to run unattended and repeatedly: the script treats QA TASK BOARD itself as the source of truth for what's already been migrated, so it only ever creates tickets for tasks it hasn't seen before. It does **not** run in the safer "verify one task first" mode you'd use locally — there's no human in the loop to check a single result before it processes everything, so make sure you've already verified the script's behavior locally (dry run, then `--execute` on one task per board) before turning this on.

If you only want the Cliq notifications automated and not ticket creation, remove the "Create QA tickets from DEV-board tasks" step from the workflow.

Set these GitHub repository secrets:

- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_REFRESH_TOKEN` — needs every scope both scripts use: `ZohoProjects.projects.READ`, `ZohoProjects.tasks.READ`, `ZohoProjects.tasks.CREATE`, `ZohoProjects.tags.CREATE` (unless you set `QA_DEV_FRONTEND_TAG_ID`/`QA_DEV_BACKEND_TAG_ID`), and `ZohoProjects.users.READ` if you want QA task owners assigned automatically.
- `CLIQ_WEBHOOK_URL`

Set these GitHub repository variables as needed:

- `ZOHO_PORTAL_ID` or `ZOHO_PORTAL_IDS`
- `MONITOR_ALL_PROJECTS`
- `ZOHO_PROJECT_IDS`
- `ZOHO_PROJECT_NAMES`
- `ZOHO_PROJECTS`
- `TARGET_STATUS_NAMES`
- `TARGET_STATUS_NAME`
- `PROJECT_CLIQ_MENTIONS` — the workflow only reads this inline variable, not `PROJECT_CLIQ_MENTIONS_FILE` (that file is gitignored and never reaches the runner). Paste the full contents of your local `project-cliq-mentions.json` in here as this variable's value — GitHub Actions variables aren't limited to one line the way `.env`/dotenv is, so the same multi-line JSON works unchanged. Keep this variable updated whenever you edit `project-cliq-mentions.json` locally, or the automated ticket creation won't assign the owners you've configured.
- `QA_DEV_DEFAULT_OWNER_EMAIL`
- `DEBUG_TASKS`
- `ZOHO_ACCOUNTS_BASE_URL` if not using `https://accounts.zoho.com`
- `ZOHO_PROJECTS_BASE_URL` if not using `https://projectsapi.zoho.com/api/v3`

The workflow stores duplicate-notification state in [`.github/notifier-state/notified.json`](/mnt/c/Users/phili/Desktop/pandora/zoho-qa-status-notifier/zoho-qa-status-notifier/.github/notifier-state/notified.json) and commits updates back to the repository after each run. That commit step always runs (even if QA ticket creation fails) so a problem creating tickets never blocks the notifier's own duplicate-suppression state from being saved.

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
