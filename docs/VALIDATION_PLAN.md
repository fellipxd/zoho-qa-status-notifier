# Validation Plan

## Functional scenarios

| Test | Action | Expected result |
|---|---|---|
| Config validation | Run `npm run test-config` with missing env vars | Script fails and names missing variables |
| OAuth validation | Run `npm run test-config` with valid Zoho credentials | Access token refresh succeeds |
| All-project discovery | Set `MONITOR_ALL_PROJECTS=true` and run `npm run test-config` | Script discovers all accessible projects in the configured portal(s) |
| Project access | Run `npm run test-config` | Script can fetch at least page 1 of tasks for every configured or discovered board |
| Cliq access | Run `npm run test-config` | Test message appears in Cliq channel |
| QA notification | Move a task to QA and run `npm run check` | One notification is sent and includes the board name |
| Multi-status notification | Configure `TARGET_STATUS_NAMES=QA,UAT` and move tasks into each status | One notification is sent for each configured status match |
| Duplicate suppression | Run `npm run check` again without changing task | No duplicate notification is sent |
| Multi-board notification | Move one task to QA in each configured board | One notification is sent per matching task, with the correct board name |
| Cross-board task IDs | Use two boards that have the same task ID value | Duplicate suppression is scoped by board and does not suppress the second board |
| Non-target status | Move task to a status not listed in `TARGET_STATUS_NAMES` | No notification is sent |
| Missing owner | Use a task with no assignee | Message sends with `Unassigned` |
| Pagination | Use a board with more than 100 tasks | Script checks additional pages if API returns has-more metadata |

## Regression risks

- Zoho Projects API response fields may differ by data center, API version, or account configuration.
- Local JSON state is not suitable for serverless environments with ephemeral storage.
- Cliq webhook token permissions may be restricted by channel or org policy.
- A bad portal/project ID can stop a check before later boards are processed.
- All-project discovery checks every accessible project, so large portals can increase API usage and runtime.

## Recommended go-live check

1. Set `DEBUG_TASKS=true`.
2. Run `npm run check`.
3. Confirm that task `status` is being normalized correctly for each board.
4. Set `DEBUG_TASKS=false`.
5. Move one test task into each configured target status.
6. Run `npm run check`.
7. Confirm one Cliq message is sent per matching task/status.
