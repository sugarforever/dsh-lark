# Changelog

## Unreleased

- Optionally show a single Feishu/Lark processing reaction while an Agent turn runs and remove the bot-owned reaction after the reply or fallback completes.
- Add channel-level `reasoningEffort` and `maxTokens` Agent overrides.
- Log redacted per-message acknowledgement, Agent, send, total-duration, tool-count, and outcome metrics.

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
