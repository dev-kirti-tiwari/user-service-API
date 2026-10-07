import { mkdtempSync, rmSync } from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import EmbeddedPostgres from 'embedded-postgres';

/**
 * Integration tests run against a real PostgreSQL. If TEST_DATABASE_URL is set it is used as-is;
 * otherwise a throwaway embedded PostgreSQL instance is started for the test run.
 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

export default async function setup() {
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    return;
  }

  const port = await freePort();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'user-service-pg-'));
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('triostack_users_test');
  process.env.DATABASE_URL = `postgresql://postgres:postgres@localhost:${port}/triostack_users_test`;

  return async () => {
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}
