import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const origin = new URL(req.url).origin || 'https://creators.makeable.nyc';

  const openapiSpec = {
    openapi: '3.1.0',
    info: {
      title: 'MakeAble Mail API',
      description: 'API for sending creator outreach and HR emails with auto-rotation, suppression checks, and custom Reply-To routing.',
      version: '1.0.0'
    },
    servers: [
      {
        url: origin,
        description: 'MakeAble Production Server'
      }
    ],
    paths: {
      '/api/v1/send-mail': {
        post: {
          operationId: 'sendMail',
          summary: 'Send an email',
          description: 'Dispatches an email through MakeAble sender rotation (Outreach + HR senders). Supports custom replyTo, fromEmail, senderName, and cc/bcc copy recipients.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['toEmail', 'body'],
                  properties: {
                    toEmail: {
                      type: 'string',
                      format: 'email',
                      description: 'Destination email address of the recipient.'
                    },
                    body: {
                      type: 'string',
                      description: 'Plain-text or light-markdown body of the email.'
                    },
                    subject: {
                      type: 'string',
                      description: 'Optional subject line. Falls back to rotating preset subjects if omitted.'
                    },
                    replyTo: {
                      type: 'string',
                      format: 'email',
                      description: 'Optional Reply-To email address (e.g. support@makeable.nyc, hr@makeable.work, or a custom Gmail).'
                    },
                    cc: {
                      type: 'array',
                      items: { type: 'string', format: 'email' },
                      maxItems: 50,
                      description: 'Optional CC recipients (visible copy). Also accepts a comma-separated string.'
                    },
                    bcc: {
                      type: 'array',
                      items: { type: 'string', format: 'email' },
                      maxItems: 50,
                      description: 'Optional BCC recipients (hidden copy). Also accepts a comma-separated string.'
                    },
                    fromEmail: {
                      type: 'string',
                      format: 'email',
                      description: 'Optional specific sender email from the configured sender pool.'
                    },
                    senderName: {
                      type: 'string',
                      description: 'Optional display name override (e.g. "MakeAble HR Team").'
                    },
                    username: {
                      type: 'string',
                      description: 'Optional creator username for tracking purposes.'
                    }
                  }
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Email successfully dispatched.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      status: { type: 'string' },
                      messageId: { type: 'string' },
                      senderEmail: { type: 'string' },
                      replyTo: { type: 'string' },
                      cc: { type: 'array', items: { type: 'string' } },
                      bcc: { type: 'array', items: { type: 'string' } },
                      skippedCopyRecipients: { type: 'array', items: { type: 'object' }, description: 'CC/BCC addresses skipped because they are suppressed.' },
                      rotationStep: { type: 'string' },
                      todaySentCount: { type: 'number' },
                      dailyLimit: { type: 'number' },
                      remainingQuota: { type: 'number' }
                    }
                  }
                }
              }
            },
            '400': { description: 'Missing required parameters or invalid recipient.' },
            '401': { description: 'Unauthorized or invalid API key.' },
            '429': { description: 'Daily limit reached.' }
          }
        }
      },
      '/api/v1/limit': {
        get: {
          operationId: 'getLimit',
          summary: 'Check sending quota and limits',
          description: 'Returns the remaining daily quota, today sent count, and limit for the API key.',
          responses: {
            '200': {
              description: 'Quota information.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      dailyLimit: { type: 'number' },
                      todaySentCount: { type: 'number' },
                      remainingQuota: { type: 'number' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'Your MakeAble API Key (mk_live_...)'
        }
      }
    },
    security: [
      {
        ApiKeyAuth: []
      }
    ]
  };

  return NextResponse.json(openapiSpec, {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

