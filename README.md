# family-skylight

**I have officially LLM-pilled my entire family. My wife just wanted a grocery list.**

Instead, she got a Node.js service running an MCP bridge, an OAuth 2.1 authorization server, SQLite, JWT signing, and a child process that authenticates with Skylight's unofficial API.

All so my wife and I can tell ChatGPT to "add eggs" and watch them magically appear on the fridge.

And you know what? **It actually works.**

I regret absolutely nothing.

## What is this?

This is a small HTTP bridge built around [chrischall/skylight-mcp](https://github.com/chrischall/skylight-mcp), which handles all the actual communication with Skylight.

The goal was pretty simple: let my wife and me manage our family calendar, grocery lists, and chores directly from ChatGPT.

The implementation, naturally, got a little out of hand.

Here's what we've got:

- **An MCP bridge:** Runs the upstream Skylight MCP server as a child process and exposes 11 of its 114 tools through Streamable HTTP at `/mcp`. The other 103 can stay right where they are. I don't need ChatGPT accidentally deleting our family calendar because it misunderstood something I said at 11 PM.
- **OAuth 2.1:** Uses [Better Auth](https://better-auth.com) in the same Node process. No external identity provider, no Auth0 subscription, and no third party deciding whether my kids have soccer practice.
- **SQLite:** Stores authentication data in a single `auth.sqlite` file, using Node's built-in `node:sqlite`. No Postgres, no Redis, no elaborate infrastructure. We're managing groceries, not running Netflix.
- **Persistent credentials:** Keeps Skylight's rotating refresh tokens in a Docker volume. We run exactly one upstream process to avoid stepping on those tokens.
- **An allowlist:** Only users explicitly listed in `ALLOWED_SUBJECTS` can access the MCP tools. Everyone else gets a `401` and some OAuth metadata they'll probably never read.

The end result is that two separate ChatGPT Plus accounts can securely talk to the same family Skylight.

### Architecture

```text
ChatGPT (two Plus accounts)
    │
    │ OAuth 2.1 + PKCE
    │ Client identity via CIMD
    │ No client registration or client secret
    ▼
Hono
    │
    ├── /api/auth/*
    │   └── Better Auth (OAuth, tokens, JWKS, sign-in)
    │
    ├── /.well-known/*
    │   └── OAuth discovery (RFC 8414 + RFC 9728)
    │
    ├── /sign-in, /consent
    │   └── Two very boring HTML pages
    │
    └── /mcp
        │
        ├── Verify JWT
        ├── Check user allowlist
        ├── Check tool allowlist
        │
        ▼
    skylight-mcp (stdio child process)
        │
        ▼
    Skylight API
        │
        ▼
    The fridge
```

## Getting it running

You'll need:

- Node.js 24+ (for `node:sqlite`)
- Docker, if you're deploying it
- A Skylight account
- A willingness to put more engineering effort into a grocery list than anyone reasonably should

One thing worth mentioning: **Skylight doesn't provide a public API for this.** The upstream MCP server uses an unofficial authentication flow, so you'll need your Skylight email and password rather than an API key.

### Local development (no authentication)

If you just want to see the MCP tools without messing around with OAuth:

```bash
npm install
npm run build

HOST=127.0.0.1 \
LOCAL_NO_AUTH=true \
MCP_DATA_DIR=$PWD/.local-data \
npm start
```

Then try listing the available tools:

```bash
curl -N http://127.0.0.1:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'
```

`LOCAL_NO_AUTH=true` only works when `HOST` is a loopback address.

Yes, I actually enforce that.

I love convenience, but not enough to put an unauthenticated household API on the public internet.

### Local development (with OAuth)

Want to test the whole authentication flow? Here's how.

```bash
export HOST=127.0.0.1
export PUBLIC_URL=http://127.0.0.1:3000
export BETTER_AUTH_SECRET="$(openssl rand -base64 48)"
export MCP_DATA_DIR=$PWD/.local-data
export ALLOW_DCR=true

SEED_PASSWORD='something' \
  node dist/seed-user.js me@example.com Me
```

The seed command creates a user and prints an ID.

Add that ID to your allowlist:

```bash
ALLOWED_SUBJECTS=<your-user-id> npm start
```

Now point MCP Inspector (or another OAuth-capable MCP client) at:

```text
http://127.0.0.1:3000/mcp
```

You should get the full OAuth experience:

1. The client discovers our authorization server.
2. You're redirected to `/sign-in`.
3. You sign in and approve access at `/consent`.
4. The client receives an EdDSA-signed JWT.
5. You can start calling tools.

`ALLOW_DCR=true` enables dynamic client registration for testing older MCP clients.

ChatGPT uses CIMD, so it doesn't need that registration endpoint.

Pretty neat, actually.

## Deploying it

I personally use [Dokploy](https://dokploy.com), because I already have a VPS and apparently can't go three weeks without deploying something to it.

But this should work anywhere you can run the included `compose.yaml`.

### 1. Configure your environment

Set these variables:

```dotenv
PUBLIC_URL=https://skylight.yourdomain.com
BETTER_AUTH_SECRET=<generate-a-strong-secret>

SKYLIGHT_EMAIL=<your-skylight-email>
SKYLIGHT_PASSWORD=<your-skylight-password>

ALLOWED_SUBJECTS=placeholder
```

Yes, `placeholder` is intentional.

The server refuses to start without an allowlist, but we haven't created our users yet.

### 2. Deploy the container

Deploy through Dokploy or Docker Compose.

Once it's running, visit:

```text
https://skylight.yourdomain.com/.well-known/oauth-authorization-server/api/auth
```

Look for the `issuer` field.

It should look like:

```json
{
  "issuer": "https://skylight.yourdomain.com/api/auth"
}
```

If it's returning `http://` instead of `https://`, double-check `PUBLIC_URL`.

OAuth is not particularly forgiving about that sort of thing.

### 3. Create your users

This part matters: **run these commands inside the deployed container.**

```bash
node dist/seed-user.js you@example.com "You"

node dist/seed-user.js spouse@example.com "Spouse"
```

Each command prompts for a password and prints something like:

```text
ALLOWED_SUBJECTS entry: <user-id>
```

Save those IDs.

And yes, you really need to run this inside the container, because that's where `auth.sqlite` lives.

If you run the seed script on your laptop instead, congratulations! You've created users in a completely different database.

I may or may not have learned that the hard way.

### 4. Update the allowlist

Add both IDs:

```dotenv
ALLOWED_SUBJECTS=id-for-you,id-for-spouse
```

Redeploy.

Now your server knows which two humans are allowed to communicate with the fridge.

### 5. Connect ChatGPT

On each ChatGPT account:

1. Open the Plugins settings.
2. Add a custom MCP server.
3. Enter your endpoint:

   ```text
   https://skylight.yourdomain.com/mcp
   ```

4. Select OAuth authentication.
5. Leave the client ID and client secret blank.
6. Sign in with the user you created.
7. Approve access.

Once connected, try:

> Run the Skylight healthcheck.

If everything is configured correctly, ChatGPT should be able to communicate with the upstream Skylight server.

Then try something slightly more exciting:

> What's on our family calendar this week?

Or, if you're feeling particularly brave:

> Add "My husband is a genius" to the grocery list.

That last one has been tested in production. You're welcome.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `PUBLIC_URL` | Yes | Public HTTPS origin. Used to build the OAuth issuer and MCP resource URLs. No trailing slash. |
| `BETTER_AUTH_SECRET` | Yes | At least 32 characters. Used for OAuth state and encrypting the JWT signing key. Rotating it invalidates existing tokens. |
| `ALLOWED_SUBJECTS` | Yes | Comma-separated Better Auth user IDs allowed to invoke MCP tools. |
| `SKYLIGHT_EMAIL` | Yes | Skylight account email. |
| `SKYLIGHT_PASSWORD` | Yes | Skylight account password. |
| `SKYLIGHT_FRAME_ID` | No | Useful when the account has multiple Skylight frames. |
| `AUTH_PROVIDER` | No | `builtin` by default, or `external` for another JWT provider. |
| `OAUTH_ISSUER` | External auth | JWT issuer for an external provider. |
| `OAUTH_JWKS_URL` | External auth | Public key endpoint for external JWT verification. |
| `OAUTH_AUDIENCE` | External auth | Expected token audience. |
| `ALLOW_DCR` | No | Enables `/oauth2/register` for older MCP clients. Disabled by default. |
| `ACCESS_TOKEN_TTL_SECONDS` | No | Access token lifetime. Defaults to 30 days. |
| `MCP_DATA_DIR` | No | Persistent storage directory. Defaults to `/data` inside the container. |
| `LOCAL_NO_AUTH` | No | Disables authentication for local development. Loopback only. |

## Some questionable engineering decisions (that I stand by)

### Why not Auth0?

I considered it.

It probably would've been faster to click through Auth0's dashboard than build the authentication configuration myself.

But I wanted this thing to be self-contained.

Better Auth already supports the pieces we need: PKCE, CIMD, resource-bound JWTs, OAuth discovery, and MCP integration.

Plus, it runs against the same SQLite database we're already using.

One less service to maintain. One less dependency between my wife and the grocery list.

### Why are access tokens valid for 30 days?

Because ChatGPT doesn't request `offline_access` in this flow, so Better Auth doesn't issue refresh tokens.

If access tokens expired every hour, we'd be signing back into the family calendar every hour.

That sounds like a fantastic way to ensure my wife never uses this project again.

So the default is 30 days.

It's a security tradeoff, not a universal best practice. You can shorten it with `ACCESS_TOKEN_TTL_SECONDS` if your threat model calls for it.

### Why is public sign-up disabled?

Because I have exactly two users.

There's no reason random strangers on the internet should be able to create accounts on my family's MCP server.

Users are created manually through `seed-user.js`, and they still need to appear in `ALLOWED_SUBJECTS`.

Two checks. Two humans. Zero public sign-ups.

### Why are there 17 suppressed warnings in `auth.ts`?

Better Auth's migration checker thinks certain array columns should be JSON-typed.

Its own SQLite migrations create those columns as TEXT.

So every startup generated 17 warnings about a schema that Better Auth itself created.

I filter that exact warning and leave everything else alone.

I chose peace.

### Why support both old and new MCP clients?

The MCP SDK's `createMcpHandler` supports both the older session-based protocol and the newer stateless transport.

I didn't restrict either one.

If ChatGPT changes which protocol it prefers, I'd rather not discover that because our family calendar suddenly stopped working.

### Why exactly one replica?

Skylight rotates refresh tokens.

The upstream MCP server handles that rotation, but two processes trying to refresh the same account at once could invalidate each other's credentials.

So we run one instance, with persistent storage.

No horizontal scaling. No clustering. No high-availability orchestration.

Our grocery list does not need a distributed systems paper.

## Things this project intentionally won't do

A few guardrails are worth mentioning.

**No delete operations.** The upstream MCP has 114 tools. We expose 11, and none of them delete calendar events, lists, list items, or chores.

**No automatic confirmation of risky actions.** The upstream server uses a `confirmToken` flow for sensitive writes. We keep `MCP_CONFIRM_MODE=ask-user` so ChatGPT has to show a preview and get approval.

**No horizontal scaling.** One container, one volume, one upstream process. This is intentional because of Skylight's rotating refresh tokens.

**No token logging.** Failed JWT verification doesn't dump credentials or claims into application logs.

**No public user registration.** This is a private household service, not a social network for refrigerators.

## A note about Skylight's API

This project uses an unofficial integration.

Skylight doesn't currently provide a public API for this use case, and its private endpoints can change without warning.

This project is not affiliated with, endorsed by, or supported by Skylight.

It's a personal, experimental integration shared for educational purposes. Using it may be subject to Skylight's terms of service, so review those before connecting your account.

If the unofficial API changes, the integration may break. Such is life on the undocumented side of the internet.

## Credits

A few projects deserve the credit for making this possible.

- **[chrischall/skylight-mcp](https://github.com/chrischall/skylight-mcp)** — Does all the hard work of communicating with Skylight. It provides 114 tools, real schemas, and confirmation handling. My code is basically a very opinionated bouncer standing outside its nightclub.
- **[Better Auth](https://better-auth.com)** — Particularly `@better-auth/mcp` and `@better-auth/cimd`, for making OAuth significantly less miserable than I expected.
- **[MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)** — For `createMcpHandler`, `fromJsonSchema`, and the Hono integration. Seriously, thank you.
- **My wife** — For wanting a grocery list and somehow ending up with an OAuth authorization server.

---

## Final thoughts

I started this project because I wanted my wife to be able to tell ChatGPT to add something to our family calendar without opening another app.

A few hours and an unreasonable amount of infrastructure later, we had it working.

We can now ask ChatGPT what's on our calendar, add groceries, create chores, and even find appointment emails in Gmail and turn them into actual Skylight events.

No separate AI subscription. No custom chatbot. Just the ChatGPT accounts we already use, a tiny service running on my VPS, and an unofficial Skylight integration.

Is this overengineered?

Absolutely.

Did I have fun building it?

An irresponsible amount.

**Would I do it again?**

In a heartbeat.

*I have officially LLM-pilled my family. The fridge never stood a chance.*

## License

MIT. Take it, point it at your own fridge.
