# Changelog

## 0.2.6

- Stop bundling and mounting `@sugarforever/dsh-zvec-grep`; it remains an independently installable plugin and no longer collides with an existing `zvec-grep` loader entry.
- Remove the temporary `hono` dependency, whose ownership belongs to the independently published zvec integration.

## 0.2.5

- Supply the `hono` runtime dependency required by the MCP HTTP adapter bundled through `dsh-zvec-grep`, eliminating its missing-peer warning in clean DSH Profile installs.
- Add a release regression check so future package manifests continue to satisfy the bundled MCP dependency tree.

## 0.2.4

- Install and mount `@sugarforever/dsh-zvec-grep` with the Lark bundle so created and resumed sessions receive automatic background workspace indexing and the `zvec_search` tool.
- Preserve existing Profile patches, Settings, and Credentials through the documented `dsh plugin --profile web update` flow instead of requiring a remove-and-add cycle.
- Document the one-time migration for profiles that previously installed `dsh-zvec-grep` as a separate bundle, preventing duplicate `zvec-grep` entries without deleting existing indexes.

## 0.2.3

- Raise the supported Harness range from `0.1.0-rc.7` through
  `0.1.2-rc.1` and use the official settings channels those versions provide.
- Stop importing the `settingsNamespace` runtime helper, which is absent from
  newer settings packages and prevented DSH from starting.
- Read the `lark-channel` settings section reactively through the client
  `settingsScope` service instead of a custom describe route; the page now
  tracks external edits and reconnects automatically.
- Read and remove the App Secret through the official Harness `credentials`
  RPC instead of the plugin's own HTTP surface.
- Follow a custom `appSecretRef` when describing or removing the App Secret,
  and refresh its status for both legacy and current credential update events.
- Keep only two plugin-owned HTTP actions: `GET /dsh-lark/status` (runtime
  status, which is not a settings field) and `POST /dsh-lark/apply` (atomic
  save that commits settings plus an optional secret in one reconcile).
- Drop the legacy `describe` route and the credentials describe/unset
  handling from the host settings API.
## 0.2.2

- Restore npm 12 lockfile entries required for clean Linux CI installs.

## 0.2.1

- Mark Harness-provided peer dependencies as optional for package-manager resolution, avoiding misleading missing-peer warnings in DSH Profiles.
- Keep the supported Harness range starting at `0.1.0-rc.6` while validating development and release builds against `0.1.0-rc.7`.
- Add continuous compatibility checks against the latest published Harness packages.

## 0.2.0

- Contribute an embedded **Feishu & Lark** section to Harness Settings through the plugin web client.
- Require same-origin browser requests for settings and credential mutations.
- Store App Secret through Harness Credentials using `DSH_LARK_APP_SECRET` by default.
- Apply Settings and credential changes by replacing the Lark channel without restarting Harness.
- Keep the plugin active but idle until required application credentials are configured.
- Show explicit configured and missing App Secret states without returning the secret to the browser.
- Populate linked Provider and Model selectors from the current Harness model catalog.
- Resume persisted Lark sessions after restart and reuse an already-live Agent when available.
- Print initial connection, channel, and message-handling failures to the terminal as well as the Harness logger, with App Secret redaction.
- Remove the generic configuration-file action from the Lark-focused Settings experience.

## 0.1.1

- Mount the Harness default or configured Agent Preset for Lark sessions.
- Associate Lark sessions with an explicit Workspace or the first registered Workspace.
- Start corrected sessions with a v2 identity so legacy uncomposed sessions are not reused.

## 0.1.0

- Initial Feishu/Lark WebSocket Channel integration for DeepSeek Harness.
- Stable chat/thread to Harness Session mapping.
- Official SDK policy, deduplication, stale-event filtering, and per-chat queue reuse.
