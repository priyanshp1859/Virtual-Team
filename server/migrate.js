import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

try { process.loadEnvFile('.env.local'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url || !/^postgres(?:ql)?:\/\//.test(url)) throw new Error('Set DATABASE_URL or POSTGRES_URL before running the migration.');
const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10 });
try {
  for (const name of ['001-workspace.sql', '002-runtime.sql', '003-project-workflow.sql']) {
    const migration = await readFile(new URL(`../db/${name}`, import.meta.url), 'utf8');
    await sql.begin(async (tx) => { await tx.unsafe(migration); });
  }
  console.log('Virtual Team workspace schema is ready. Existing records were preserved.');
} catch {
  console.error('Workspace migration failed. Check database access and permissions.');
  process.exitCode = 1;
} finally { await sql.end(); }
