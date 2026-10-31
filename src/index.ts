import { serve } from '@hono/node-server';
import { createMcpHonoApp } from '@modelcontextprotocol/hono';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createMcpHandler, fromJsonSchema, McpServer } from '@modelcontextprotocol/server';
import type { JsonSchemaType } from '@modelcontextprotocol/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Context } from 'hono';
import path from 'node:path';
import { authOptions, createAuth, migrateAuthDb, type Auth } from './auth.js';
import { issuerFor, jwksUrlFor, readBuiltinAuthConfig, resourceFor } from './config.js';
import { consentPage, signInPage } from './pages.js';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);
const publicUrl = process.env.PUBLIC_URL?.replace(/\/$/, ''); // e.g. https://skylight.example.com
const allowedSubjects = new Set(
  (process.env.ALLOWED_SUBJECTS ?? '').split(',').map(s => s.trim()).filter(Boolean)
);

// NEVER deploy a public unauthenticated MCP endpoint.
const localNoAuth = process.env.LOCAL_NO_AUTH === 'true';
if (localNoAuth && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
  throw new Error('LOCAL_NO_AUTH requires loopback-only HOST');
}

// `builtin` runs Better Auth in this process as the OAuth authorization
// server; `external` trusts JWTs from a separate identity provider.
const authProvider = localNoAuth ? 'none' : (process.env.AUTH_PROVIDER ?? 'builtin');
if (!['none', 'builtin', 'external'].includes(authProvider)) {
  throw new Error(`AUTH_PROVIDER must be "builtin" or "external", got "${authProvider}"`);
}

let issuer: string | undefined;
let jwksUrl: string | undefined;
let audience: string | undefined;
let auth: Auth | undefined;

if (authProvider === 'builtin') {
  const cfg = readBuiltinAuthConfig();
  const options = authOptions(cfg);
  await migrateAuthDb(options);
  auth = createAuth(options);
  issuer = issuerFor(cfg.publicUrl);
  jwksUrl = jwksUrlFor(cfg.publicUrl);
  audience = resourceFor(cfg.publicUrl);
} else if (authProvider === 'external') {
  issuer = process.env.OAUTH_ISSUER;
  jwksUrl = process.env.OAUTH_JWKS_URL;
  audience = process.env.OAUTH_AUDIENCE;
  if (!publicUrl || !issuer || !jwksUrl || !audience) {
    throw new Error('AUTH_PROVIDER=external requires PUBLIC_URL, OAUTH_ISSUER, OAUTH_JWKS_URL, OAUTH_AUDIENCE');
  }
}
if (authProvider !== 'none' && !allowedSubjects.size) {
  throw new Error('ALLOWED_SUBJECTS must list at least one authorized user id');
}

const jwks = jwksUrl ? createRemoteJWKSet(new URL(jwksUrl)) : null;

// Explicitly approve tools rather than exposing all 114 upstream operations.
const allowlist = new Set([
  'skylight_healthcheck',
  'skylight_list_frames',
  'skylight_list_events',
  'skylight_get_event',
  'skylight_create_event',
  'skylight_update_event',
  'skylight_list_lists',
  'skylight_get_list_items',
  'skylight_add_list_item',
  'skylight_list_chores',
  'skylight_create_chore',
]);

// One persistent child process per container: important for rotating tokens.
const upstream = new Client({ name: 'family-skylight-bridge', version: '1.0.0' });
const env = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] =>
    typeof entry[1] === 'string')
);
const child = new StdioClientTransport({
  command: process.execPath,
  args: [path.resolve('node_modules/skylight-mcp/dist/index.js')],
  env,
  stderr: 'inherit',
});
await upstream.connect(child);

// Upstream schemas are already JSON Schema. Preserve them instead of
// manually reimplementing the Skylight API argument definitions.
const catalog = (await upstream.listTools()).tools
  .filter(t => allowlist.has(t.name));
if (!catalog.some(t => t.name === 'skylight_list_frames')) {
  throw new Error('Unexpected upstream tool catalog: check pinned package version');
}

const handler = createMcpHandler(() => {
  const server = new McpServer({ name: 'family-skylight', version: '1.0.0' });
  for (const tool of catalog) {
    server.registerTool(
      tool.name,
      {
        description: tool.description ?? tool.name,
        inputSchema: fromJsonSchema(tool.inputSchema as JsonSchemaType),
      },
      async (args: unknown) => {
        // The allowlist is enforced during registration and on invocation.
        if (!allowlist.has(tool.name)) throw new Error('Tool disabled');
        return await upstream.callTool({
          name: tool.name,
          arguments: args as Record<string, unknown>,
        });
      }
    );
  }
  return server;
});

const domain = publicUrl ? new URL(publicUrl).hostname : 'localhost';
const app = createMcpHonoApp({
  host,
  allowedHosts: [domain, 'localhost', '127.0.0.1'],
});

app.get('/health', c => c.json({ ok: true }));

if (auth) {
  const betterAuth = auth;
  const forward = (c: Context) => betterAuth.handler(c.req.raw);
  // OAuth endpoints, JWKS, sign-in API; plus RFC 8414 / RFC 9728 discovery,
  // which Better Auth answers at the site root.
  app.all('/api/auth/*', forward);
  app.all('/.well-known/*', forward);
  app.get('/sign-in', c => c.html(signInPage()));
  app.get('/consent', c => c.html(consentPage()));
} else if (authProvider === 'external') {
  // RFC 9728 metadata: ChatGPT uses this to discover OAuth authorization.
  // The upstream Skylight OAuth flow is unrelated to THIS resource OAuth.
  const metadata = {
    resource: audience,
    authorization_servers: [issuer],
    scopes_supported: ['skylight:access'],
    bearer_methods_supported: ['header'],
  };
  app.get('/.well-known/oauth-protected-resource', c => c.json(metadata));
  app.get('/.well-known/oauth-protected-resource/mcp', c => c.json(metadata));
}

app.use('/mcp', async (c, next) => {
  if (authProvider === 'none') return next();
  const raw = c.req.header('authorization') ?? '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : '';
  if (token) {
    try {
      const { payload } = await jwtVerify(token, jwks!, {
        issuer,
        audience,
      });
      if (typeof payload.sub === 'string' && allowedSubjects.has(payload.sub)) {
        return next();
      }
    } catch {
      // Deliberately avoid logging the bearer token or JWT claims.
    }
  }
  c.header('WWW-Authenticate',
    `Bearer resource_metadata="${publicUrl}/.well-known/oauth-protected-resource"`);
  return c.json({ error: 'unauthorized' }, 401);
});

app.all('/mcp', (c: Context) =>
  handler.fetch(c.req.raw, { parsedBody: c.get('parsedBody') })
);

serve({ fetch: app.fetch, hostname: host, port });
console.error(`Family Skylight MCP ready on ${host}:${port} (auth: ${authProvider})`);

const shutdown = async () => {
  await upstream.close();
  process.exit(0);
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
