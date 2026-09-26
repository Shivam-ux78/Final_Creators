import { supabase } from './supabase';
import { getSuppression, addSuppression, listSuppressions, normalizeEmail } from './suppressions';
import { getOrCreateConnectorKeyAsync } from './api-keys-storage';

// Tools exposed by the MCP connector at /api/mcp.
// Calls /api/v1/* with the connector's own auto-provisioned API key ("MCP Connector",
// 500/day). The key is looked up server-side per call and never returned to the client.

export interface ToolContext {
  apiBase: string;
  user: string;
  clientId: string;
}

export class ToolError extends Error {
  details?: unknown;
  constructor(message: string, details?: unknown) {
    super(message);
    this.details = details;
  }
}

interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, any>;
  annotations: Record<string, boolean>;
  handler: (args: Record<string, any>, ctx: ToolContext) => Promise<unknown>;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireEmail(value: unknown, field: string): string {
  const email = normalizeEmail(typeof value === 'string' ? value : '');
  if (!EMAIL_PATTERN.test(email)) throw new ToolError(`"${field}" must be a valid email address.`);
  return email;
}

function optionalString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new ToolError(`"${field}" must be a string.`);
  if (value.length > maxLength) throw new ToolError(`"${field}" must be at most ${maxLength} characters.`);
  return value.trim();
}

async function callMailApi(ctx: ToolContext, path: string, init: { method: 'GET' | 'POST'; body?: unknown }) {
  const connectorKey = await getOrCreateConnectorKeyAsync();
  if (connectorKey.status === 'revoked') {
    throw new ToolError('The "MCP Connector" API key is revoked. Rotate it in the dashboard to re-enable sending.');
  }
  const apiKey = connectorKey.key;

  const res = await fetch(`${ctx.apiBase}${path}`, {
    method: init.method,
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store'
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new ToolError(data.error || `Mail API returned HTTP ${res.status}.`, { httpStatus: res.status, ...data });
  }
  return data;
}

async function getRecipientStatus(email: string) {
  const { data, error } = await supabase
    .from('creators')
    .select('username, email, email_status, last_emailed_at, email_subject')
    .ilike('email', email)
    .limit(5);

  if (error) throw new ToolError(`Failed to look up recipient: ${error.message}`);
  // ilike treats "_" as a wildcard, so confirm exact (case-insensitive) matches
  return (data || []).filter((r: any) => normalizeEmail(r.email || '') === email);
}

export const TOOLS: ToolDefinition[] = [
  {
    name: 'get_limit',
    title: 'Get sending limit',
    description: 'Get the daily email limit, how many emails have been sent today, and the remaining quota for the connector\'s API key.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (_args, ctx) => callMailApi(ctx, '/api/v1/limit', { method: 'GET' })
  },
  {
    name: 'send_mail',
    title: 'Send email',
    description: 'Send one email through the MakeAble sender rotation (collab@makeable.work / .website / .online). Suppressed recipients are refused. If no subject is given, a preset subject is used. Counts against the daily limit.',
    inputSchema: {
      type: 'object',
      properties: {
        to_email: { type: 'string', description: 'Recipient email address.' },
        body: { type: 'string', description: 'Plain-text / light-markdown email body.' },
        subject: { type: 'string', description: 'Optional subject line. Falls back to the preset rotation.' },
        username: { type: 'string', description: 'Optional creator username, used to mark the creator as emailed.' }
      },
      required: ['to_email', 'body'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    handler: async (args, ctx) => {
      const toEmail = requireEmail(args.to_email, 'to_email');
      const body = optionalString(args.body, 'body', 20000);
      if (!body) throw new ToolError('"body" is required.');
      const subject = optionalString(args.subject, 'subject', 300);
      const username = optionalString(args.username, 'username', 200);

      const suppression = await getSuppression(toEmail);
      if (suppression) {
        throw new ToolError(`${toEmail} is on the suppression list${suppression.reason ? ` (${suppression.reason})` : ''}. Email not sent.`);
      }

      return callMailApi(ctx, '/api/v1/send-mail', {
        method: 'POST',
        body: { toEmail, body, subject, username }
      });
    }
  },
  {
    name: 'get_status',
    title: 'Get mail status',
    description: 'Get the mail service status (next sender, preset subjects, today\'s count, remaining quota). If "email" is given, also returns whether that recipient was already emailed and whether they are suppressed.',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Optional recipient email to look up.' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (args, ctx) => {
      const service = await callMailApi(ctx, '/api/v1/send-mail', { method: 'GET' });
      if (args.email === undefined || args.email === '') return { service };

      const email = requireEmail(args.email, 'email');
      const [records, suppression] = await Promise.all([getRecipientStatus(email), getSuppression(email)]);
      return {
        service,
        recipient: {
          email,
          suppressed: !!suppression,
          suppression,
          alreadyEmailed: records.some((r: any) => r.email_status === 'sent'),
          records
        }
      };
    }
  },
  {
    name: 'add_suppression',
    title: 'Add suppression',
    description: 'Add an email address to the suppression list so it is never emailed again (e.g. unsubscribe, bounce, complaint). Re-adding an existing address updates its reason.',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Email address to suppress.' },
        reason: { type: 'string', description: 'Why it is suppressed, e.g. "unsubscribed", "bounced".' }
      },
      required: ['email'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (args, ctx) => {
      const email = requireEmail(args.email, 'email');
      const reason = optionalString(args.reason, 'reason', 500) || '';
      const suppression = await addSuppression(email, reason, `mcp:${ctx.user}`);
      return { success: true, suppression };
    }
  },
  {
    name: 'list_suppressions',
    title: 'List suppressions',
    description: 'List suppressed email addresses, newest first. Optionally filter by a partial email match.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Optional partial email to filter by.' },
        limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Max results (default 50).' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (args) => {
      const limit = Number.isInteger(args.limit) ? Math.min(Math.max(args.limit, 1), 500) : 50;
      const search = optionalString(args.search, 'search', 200);
      const suppressions = await listSuppressions(limit, search);
      return { count: suppressions.length, suppressions };
    }
  }
];
