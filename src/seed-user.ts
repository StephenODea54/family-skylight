// Creates one of the two household accounts. Run inside the deployed
// container so it writes to the same SQLite file the server uses:
//   node dist/seed-user.js you@example.com "Your Name"
// The password is read from SEED_PASSWORD or prompted for without echo.
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { readBuiltinAuthConfig } from './config.js';
import { authOptions, createAuth, migrateAuthDb } from './auth.js';

const [email, name] = process.argv.slice(2);
if (!email) {
  console.error('usage: node dist/seed-user.js <email> [name]');
  process.exit(2);
}

async function readPassword(): Promise<string> {
  if (process.env.SEED_PASSWORD) return process.env.SEED_PASSWORD;
  const muted = new Writable({ write: (_chunk, _enc, cb) => cb() });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  process.stderr.write('Password: ');
  const password = await rl.question('');
  process.stderr.write('\n');
  rl.close();
  return password;
}

const password = await readPassword();
if (password.length < 8) {
  console.error('password must be at least 8 characters');
  process.exit(2);
}

const options = authOptions(readBuiltinAuthConfig(), { allowSignUp: true });
await migrateAuthDb(options);
const auth = createAuth(options);
const result = await auth.api.signUpEmail({
  body: { email, password, name: name ?? email.split('@')[0]! },
});
console.log(`created ${result.user.email}`);
console.log(`ALLOWED_SUBJECTS entry: ${result.user.id}`);
