import { randomUUID } from 'node:crypto';
import { openTestDatabase } from '../../src/testing/node-sqlite.ts';
import { LocalRepository } from '../../src/data/local/repository.ts';
const db = openTestDatabase(process.argv[2]);
const repository = new LocalRepository(db, randomUUID);
repository.create(process.argv[3], { id: randomUUID(), mutationId: randomUUID(), quantity: 15, occurredAt: '2026-09-10T15:00:00Z', timezone: 'UTC' });
// Exit without calling SQLite close or any app shutdown handler.
process.exit(0);
