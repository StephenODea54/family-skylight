import path from 'node:path';

export const authBasePath = '/api/auth';

export interface BuiltinAuthConfig {
  publicUrl: string;
  secret: string;
  dbPath: string;
  allowDcr: boolean;
  accessTokenTtlSeconds: number;
}

// Better Auth's issuer is its base URL including the base path, and the JWT
// plugin publishes its JWKS underneath it.
export const issuerFor = (publicUrl: string) => `${publicUrl}${authBasePath}`;
export const jwksUrlFor = (publicUrl: string) => `${publicUrl}${authBasePath}/jwks`;
export const resourceFor = (publicUrl: string) => `${publicUrl}/mcp`;

export function readBuiltinAuthConfig(env: NodeJS.ProcessEnv = process.env): BuiltinAuthConfig {
  const publicUrl = env.PUBLIC_URL;
  const secret = env.BETTER_AUTH_SECRET;
  if (!publicUrl) throw new Error('PUBLIC_URL is required');
  if (!secret || secret.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must be set to at least 32 random characters');
  }
  const dataDir = env.MCP_DATA_DIR ?? '/data';
  return {
    publicUrl: publicUrl.replace(/\/$/, ''),
    secret,
    dbPath: env.AUTH_DB_PATH ?? path.join(dataDir, 'auth.sqlite'),
    allowDcr: env.ALLOW_DCR === 'true',
    // Refresh tokens are only issued for the `offline_access` scope, which
    // ChatGPT does not request from the protected-resource metadata, so a
    // short access-token TTL would mean re-authorizing the connector hourly.
    accessTokenTtlSeconds: Number(env.ACCESS_TOKEN_TTL_SECONDS ?? 60 * 60 * 24 * 30),
  };
}
