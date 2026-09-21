import { randomUUID } from 'node:crypto';
import { openTestDatabase } from '../../src/testing/node-sqlite.ts';
const db = openTestDatabase(process.argv[2]);
db.transaction(() => {
  db.run("INSERT INTO local_checkins(partition_id,id,quantity,occurred_at,recorded_timezone,local_date,source,state) VALUES(?,?,99,'2026-09-11T12:00:00.000Z','UTC','2026-09-11','native','pending')", process.argv[3], randomUUID());
  // Exit between the record and outbox writes, before COMMIT or graceful shutdown.
  process.exit(73);
});
