# MakeAble Mail MCP Connector

A remote MCP server at `https://creators.makeable.nyc/api/mcp` that lets Codex / ChatGPT send mail **without ever seeing the mail API key**.

```
Codex ──OAuth token──▶ /api/mcp ──x-api-key (server env only)──▶ /api/v1/send-mail
```

- Codex authenticates with OAuth (login + consent on the dashboard).
- The mail API key is read only from the `MAKEABLE_MAIL_API_KEY` server env var and is never returned by any tool.
- Tools: `get_limit`, `send_mail`, `get_status`, `add_suppression`, `list_suppressions`.

## One-time setup

1. **Create the suppression table.** Run the `EMAIL SUPPRESSION LIST` section at the bottom of `schema.sql` in the Supabase SQL editor.
   `/api/v1/send-mail` checks this list before every send and **refuses to send if the table is missing**.

2. **Rotate the API key.** In the dashboard, create a new API key and revoke **every** existing key (the old ones were exposed in chat and in git history).

3. **Set server env vars** on the hosting provider (never in code, prompts, Supabase rows or plugin files):

   | Variable | Value |
   |---|---|
   | `MAKEABLE_MAIL_API_KEY` | the new `mk_live_...` key from step 2 |
   | `MCP_OAUTH_SECRET` | random 32+ chars, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `PUBLIC_BASE_URL` | `https://creators.makeable.nyc` (used as the OAuth issuer / resource URL) |
   | `MAKEABLE_API_BASE_URL` | optional; where the connector calls `/api/v1/*` (defaults to `PUBLIC_BASE_URL`) |

   Also make sure `ADMIN_PASSWORD` and `AUTH_SECRET` are set to strong values, because the dashboard login is what grants OAuth access.

4. Deploy.

## Connect Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.makeable-mail]
url = "https://creators.makeable.nyc/api/mcp"
```

Then run `codex mcp login makeable-mail`. A browser opens, you log in to the dashboard and click **Allow**.
In ChatGPT, add the same URL as a custom connector (Settings → Connectors, developer mode).

Update the automation prompt to call the `send_mail` / `get_limit` tools, and remove any mention of a key.

## Revoking access

- **All connector sessions:** change `MCP_OAUTH_SECRET` and redeploy. Every client, code and token is invalidated.
- **The mail key:** revoke it in the dashboard, create a new one, and update `MAKEABLE_MAIL_API_KEY`.

Tokens: access tokens last 1 hour, refresh tokens 30 days, auth codes 5 minutes (PKCE S256 required).
