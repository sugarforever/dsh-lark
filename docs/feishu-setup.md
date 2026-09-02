# Feishu / Lark Console Setup

1. Create a custom app in the Feishu or Lark developer console.
2. Enable the Bot capability and choose a bot name/avatar.
3. Add the permissions required to receive messages and send replies. When `typingReaction` is configured, also add `im:message.reactions:write_only` so the bot can add and remove its processing reaction. The console can derive the receive scopes when `im.message.receive_v1` is added; submit them for administrator approval when required by the tenant.
4. In **Events & Callbacks / Event Subscriptions**, choose **Use long connection to receive events** (WebSocket). Do not configure a webhook URL.
5. Add the event `im.message.receive_v1`.
6. Create and publish an app version, then install the app in the tenant or test tenant.
7. Copy App ID and App Secret into `FEISHU_APP_ID` and `FEISHU_APP_SECRET` in the environment that starts DSH.
8. Enable the plugin entry and start the Harness profile. A successful startup logs `dsh-lark: WebSocket connected`.
9. In a direct chat, send a message to the bot. In a group, mention the bot unless `requireMention` is intentionally disabled and the broader group-message permission has been approved.

## Troubleshooting

- No events: confirm the app version is published, the bot is installed in the chat, `im.message.receive_v1` is subscribed, and long connection mode is selected.
- Direct messages rejected: check `dmMode` and `dmAllowlist`.
- Group messages ignored: mention the bot, or check `groupAllowlist` and tenant permission approval.
- Authentication failure during startup: rotate and re-copy App ID/App Secret; the SDK distinguishes permission errors from connection errors.
- No processing reaction: confirm `typingReaction` is configured and the published app version has the `im:message.reactions:write_only` tenant permission. Reaction failures are best-effort and do not block the final reply.
- Repeated reconnects: check outbound TLS/WebSocket access and proxies. Only one consumer should use a given app's event stream when deterministic delivery is required because the platform load-balances across long connections.
