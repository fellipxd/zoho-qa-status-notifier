# Values Needed From You

To run this automation, provide these values in `.env`:

```env
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_REFRESH_TOKEN=
ZOHO_PORTAL_ID=
MONITOR_ALL_PROJECTS=true
TARGET_STATUS_NAMES=QA,UAT,Ready for Release
CLIQ_WEBHOOK_URL=
```

If you need to monitor all projects in multiple Zoho Projects portals, use this instead of `ZOHO_PORTAL_ID`:

```env
ZOHO_PORTAL_IDS=portal_1,portal_2
MONITOR_ALL_PROJECTS=true
```

If you only want selected projects, set `MONITOR_ALL_PROJECTS=false` or omit it, then provide project IDs:

```env
ZOHO_PORTAL_ID=
ZOHO_PROJECT_IDS=
ZOHO_PROJECT_NAMES=
```

If selected boards are in different portals, use this instead of `ZOHO_PORTAL_ID` and `ZOHO_PROJECT_IDS`:

```env
ZOHO_PROJECTS=[{"name":"Board One","portalId":"portal_1","projectId":"project_1"},{"name":"Board Two","portalId":"portal_2","projectId":"project_2"}]
```

## Optional values

```env
POLL_INTERVAL_MINUTES=5
DEBUG_TASKS=false
```

## Notes

- Do not paste secrets into a public channel.
- If you want help checking the `.env`, redact the sensitive parts first.
- The `CLIQ_WEBHOOK_URL` should be the full webhook URL, not only the token.
- `ZOHO_PROJECT_NAMES` is optional, but it makes the Cliq message show a readable board name.
- `TARGET_STATUS_NAMES` is comma-separated. The old `TARGET_STATUS_NAME=QA` still works for one status.
