import type { SqlDriver } from './driver.ts';

export const migrations = [
  `CREATE TABLE local_partitions (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('guest','account')),
    active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)), created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX one_active_partition ON local_partitions(active) WHERE active=1;
  CREATE TABLE local_checkins (
    partition_id TEXT NOT NULL REFERENCES local_partitions(id), id TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK(typeof(quantity)='integer' AND quantity BETWEEN 1 AND 999),
    occurred_at TEXT NOT NULL, recorded_timezone TEXT NOT NULL, local_date TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('native','import')),
    deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
    accepted_json TEXT, server_version INTEGER NOT NULL DEFAULT 0 CHECK(server_version>=0),
    server_revision TEXT NOT NULL DEFAULT '0',
    state TEXT NOT NULL CHECK(state IN ('local','pending','acknowledged','conflict','rejected')),
    PRIMARY KEY(partition_id,id)
  );
  CREATE TRIGGER immutable_checkin_fields BEFORE UPDATE OF partition_id,id,occurred_at,recorded_timezone,local_date,source ON local_checkins
  BEGIN SELECT RAISE(ABORT,'Recorded identity and time cannot change'); END;
  CREATE TRIGGER no_resurrection BEFORE UPDATE OF deleted ON local_checkins
  WHEN OLD.deleted=1 AND NEW.deleted=0 BEGIN SELECT RAISE(ABORT,'Deleted record cannot be restored'); END;
  CREATE TABLE outbox (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT, partition_id TEXT NOT NULL,
    mutation_id TEXT NOT NULL, entity_id TEXT NOT NULL, operation TEXT NOT NULL CHECK(operation IN ('create','update','delete')),
    intent_quantity INTEGER CHECK(intent_quantity BETWEEN 1 AND 999), request_json TEXT,
    base_version INTEGER, dependency_mutation TEXT, attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','acknowledged','conflict','rejected')),
    UNIQUE(partition_id,mutation_id),
    FOREIGN KEY(partition_id,entity_id) REFERENCES local_checkins(partition_id,id)
  );
  CREATE TRIGGER immutable_sent_request BEFORE UPDATE OF request_json,mutation_id ON outbox
  WHEN OLD.status <> 'pending' BEGIN SELECT RAISE(ABORT,'Sent requests are immutable'); END;
  CREATE TABLE sync_cursors (partition_id TEXT PRIMARY KEY REFERENCES local_partitions(id), revision TEXT NOT NULL DEFAULT '0');
  CREATE TABLE preferences (scope TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(scope,key));
  CREATE TABLE guest_imports (
    guest_partition TEXT NOT NULL, account_partition TEXT NOT NULL, source_id TEXT NOT NULL,
    destination_id TEXT NOT NULL, mutation_id TEXT NOT NULL, state TEXT NOT NULL,
    PRIMARY KEY(guest_partition,account_partition,source_id)
  );
  CREATE TABLE cached_queries (identity TEXT NOT NULL, scope TEXT NOT NULL, request_key TEXT NOT NULL, payload TEXT NOT NULL, fetched_at TEXT NOT NULL, expiry TEXT NOT NULL, PRIMARY KEY(identity,scope,request_key));`,
  `CREATE INDEX checkins_by_day ON local_checkins(partition_id,local_date,occurred_at DESC,id);
   CREATE INDEX outbox_ready ON outbox(partition_id,status,sequence);`,
  `CREATE INDEX outbox_entity ON outbox(partition_id,entity_id,sequence);
   ALTER TABLE outbox ADD COLUMN acknowledged_version INTEGER CHECK(acknowledged_version>=1);
   ALTER TABLE outbox ADD COLUMN retry_delay_ms INTEGER NOT NULL DEFAULT 0 CHECK(retry_delay_ms>=0);
   CREATE INDEX outbox_retry ON outbox(partition_id,next_retry_at) WHERE status IN ('pending','sending') AND next_retry_at IS NOT NULL;
   UPDATE outbox SET acknowledged_version=CASE WHEN operation='create' THEN 1 ELSE json_extract(request_json,'$.expected_version')+1 END WHERE status='acknowledged';
   CREATE TABLE sync_issues (
     partition_id TEXT NOT NULL, entity_id TEXT NOT NULL, mutation_id TEXT NOT NULL,
     code TEXT NOT NULL, current_record TEXT,
     PRIMARY KEY(partition_id,entity_id),
     FOREIGN KEY(partition_id,entity_id) REFERENCES local_checkins(partition_id,id)
   );
   DROP TRIGGER no_resurrection;
   CREATE TRIGGER no_resurrection BEFORE UPDATE OF deleted ON local_checkins
   WHEN OLD.deleted=1 AND NEW.deleted=0 AND
     (OLD.state='local' OR json_extract(OLD.accepted_json,'$.deleted_at') IS NOT NULL)
   BEGIN SELECT RAISE(ABORT,'Deleted record cannot be restored'); END;`,
];

export function migrate(db: SqlDriver, target = migrations.length) {
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.transaction(() => {
    db.exec('CREATE TABLE IF NOT EXISTS local_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);');
    const current = db.all<{ version: number }>('SELECT COALESCE(MAX(version),0) AS version FROM local_schema_migrations')[0].version;
    if (current > migrations.length) throw new Error('This database needs a newer app.');
    for (let version = current + 1; version <= target; version++) {
      db.exec(migrations[version - 1]);
      db.run('INSERT INTO local_schema_migrations(version,applied_at) VALUES(?,?)', version, new Date().toISOString());
    }
  });
}
