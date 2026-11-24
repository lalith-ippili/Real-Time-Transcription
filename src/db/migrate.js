// CLI: `npm run migrate` – creates/updates the transcriptions table.
import { closePool, runMigrations } from './index.js';

try {
  console.log('[migrate] applying schema.sql …');
  await runMigrations();
  console.log('[migrate] done ✔');
} catch (err) {
  console.error('[migrate] failed:', err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
