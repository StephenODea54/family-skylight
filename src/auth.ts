import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { jwt } from 'better-auth/plugins';
import { mcp } from '@better-auth/mcp';
import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import { DatabaseSync } from 'node:sqlite';
import { authBasePath, resourceFor, type BuiltinAuthConfig } from './config.js';

export const mcpScopes = ['openid', 'profile', 'email', 'offline_access', 'mcp:tools'];

// Better Auth's migration diff only accepts array fields in JSON-typed
// columns, but its own SQLite migrations create them as TEXT, so every boot
// would log one false "different type" warning per array column.
const sqliteArrayTypeWarning = /has a different type in the database\. Expected (string|number)\[\] but got TEXT\./;
const logger = {
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: unknown[]) {
    if (level === 'warn' && sqliteArrayTypeWarning.test(message)) return;
    console.error(`[auth] ${level}: ${message}`, ...args);
  },
};

export function authOptions(cfg: BuiltinAuthConfig, opts: { allowSignUp?: boolean } = {}) {
  return {
    baseURL: cfg.publicUrl,
    basePath: authBasePath,
    secret: cfg.secret,
    logger,
    database: new DatabaseSync(cfg.dbPath),
    // Accounts are created only by the seed script; the public sign-up
    // endpoint stays closed.
    emailAndPassword: { enabled: true, disableSignUp: !opts.allowSignUp },
    // Required by the JWT plugin in OAuth-provider mode: tokens come from
    // /oauth2/token, never from the plugin's own /token endpoint.
    disabledPaths: ['/token'],
    plugins: [
      jwt({ disableSettingJwtHeader: true }),
      mcp({
        loginPage: '/sign-in',
        consentPage: '/consent',
        resource: resourceFor(cfg.publicUrl),
        scopes: mcpScopes,
        accessTokenExpiresIn: cfg.accessTokenTtlSeconds,
        // CIMD is the primary client mechanism (ChatGPT prefers it). DCR is
        // a deliberate opt-in for older MCP clients and for the local test.
        ...(cfg.allowDcr
          ? {
              allowDynamicClientRegistration: true,
              allowUnauthenticatedClientRegistration: true,
              clientRegistrationDefaultApplicationType: 'infer' as const,
            }
          : {}),
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: 'mcp-2026-07-28' }),
    ],
  } satisfies BetterAuthOptions;
}

export type AuthOptions = ReturnType<typeof authOptions>;

export async function migrateAuthDb(options: AuthOptions) {
  const { runMigrations } = await getMigrations(options);
  await runMigrations();
}

export function createAuth(options: AuthOptions) {
  return betterAuth(options);
}

export type Auth = ReturnType<typeof createAuth>;
