import { readFileSync } from 'fs';
import jwt from 'jsonwebtoken';
import 'dotenv/config';

/**
 * Dev/test helper that mints a JWT the service accepts in AUTH_MODE=jwt.
 * In production, tokens are issued by your Auth Service - never by this script.
 *
 * Usage:
 *   npm run token -- --tenant 1001 --org 5001 --user 501200 --roles admin [--software 10] [--ttl 3600]
 *   (HS256 with JWT_SECRET; add --private-key key.pem to sign RS256 instead)
 */
function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const tenant = arg('tenant', '1001') as string;
const org = arg('org', '5001') as string;
const user = arg('user', '501200') as string;
const software = arg('software', '10') as string;
const roles = (arg('roles', 'admin') as string).split(',').map((r) => r.trim()).filter(Boolean);
const ttl = Number(arg('ttl', '3600'));
const keyFile = arg('private-key');

const issuer = process.env.JWT_ISSUER;
const audience = process.env.JWT_AUDIENCE;
if (!issuer || !audience) {
  console.error('JWT_ISSUER and JWT_AUDIENCE must be set (in .env or the environment).');
  process.exit(1);
}

const payload = { tenant_id: tenant, organization_id: org, software_id: software, roles };
const base = { issuer, audience, subject: user, expiresIn: ttl };

let token: string;
if (keyFile) {
  token = jwt.sign(payload, readFileSync(keyFile, 'utf8'), { ...base, algorithm: 'RS256' });
} else {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('JWT_SECRET must be set to mint an HS256 token (or pass --private-key).');
    process.exit(1);
  }
  token = jwt.sign(payload, secret, { ...base, algorithm: 'HS256' });
}
console.log(token);
