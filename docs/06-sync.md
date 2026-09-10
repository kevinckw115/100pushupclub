# Offline sync contract

## Guarantees and limits

Guarantee at-most-one accepted effect per (account, mutation_id), even if a network response is lost. Guarantee local save and queue insertion commit together. A new intentional tap after the first completes is a new check-in; idempotency does not collapse legitimate identical sets. Prevent double taps while the same local save is in progress.

Cross-device conflicting quantity edits are explicit, not last-write-wins. V1 sync occurs on foreground, reconnect, after local mutation, and manual retry; background execution is opportunistic and never a correctness dependency.

After verified login, profile bootstrap must complete before account synchronization. The bootstrap response revision does not acknowledge downloaded records: a new client starts its durable pull cursor at zero, and only a committed pull transaction advances it. Non-check-in operations use separate operation receipts, with live authorization checked again on replay.

## Mutation envelope

See [TypeScript contract](../contracts/domain.ts). CREATE has UUID entity/mutation IDs, quantity, occurred_at, recorded_timezone, local_date, source and requested_public_epoch. UPDATE has quantity and expected_version. DELETE has expected_version. User identity is never supplied as authority. Canonicalize validated fields server-side and hash their semantic JSON, not arbitrary client JSON key order.

## Server transaction

1. Verify permanent active account. Validate envelope shape and size. Derive user from session.
2. Lock profile then account_sync_state. Recheck account active after locks.
3. Look up receipt. Same mutation ID and hash returns the stored original result. Different hash returns IDEMPOTENCY_KEY_REUSED. Replays still require a live authorized account.
4. Validate ownership. CREATE requires unused entity ID. Existing same-owner entity under a different mutation ID returns ENTITY_EXISTS with its owner snapshot, not another insertion. UPDATE/DELETE requires expected_version == current version and nondeleted entity.
5. Validate quantity/time/consent. For CREATE, assign public metadata only if currently eligible. Input source import always private; all imported time fields still validated.
6. Increment per-account revision under the lock, apply version+1 (CREATE starts at 1), and append immutable change snapshot.
7. Store accepted result and canonical hash as receipt. Commit all writes together, then return.

Do not commit a receipt separately from its change. Version-conflict results may be returned without receipt; they have no accepted effect and require a new mutation ID after the user changes the request. Transient failures also have no receipt. DELETE replay uses original receipt even though record is now deleted.

## Client worker

The PostgreSQL transport calls `mutate_checkin` with `{envelope: mutation}` and `pull_changes` with `{after_revision, limit}`. Accepted mutation/pull envelopes include request_id. Checked RPC errors return the common JSON error body with an HTTP error status; SERVER_RETRY preserves the exact request for retry. Gateway/authentication rejections can happen before RPC execution and must also be handled by the transport. Receipt replay preserves the original accepted response including request_id. Pull holds a shared profile lock while constructing one consistent bounded page, so it cannot skip a revision still held by an earlier writer.

- One active worker per partition. The worker selects pending mutations whose dependencies are resolved and sends at most one at a time initially.
- Mark sending durably before transport. Once a request might have left the device, never modify its ID or payload. If response is uncertain, resend the exact request.
- On acceptance, atomically store accepted snapshot, mark acknowledged, and rebuild visible projection from remaining local intents. Then pull server changes.
- Edits/deletes queued behind an in-flight create retain user intent locally; materialize their immutable request only after learning the accepted version. Dependent edits after conflicts wait for resolution.
- On network/429/5xx retry with jittered backoff 1, 2, 4, 8... seconds capped at 60, respecting Retry-After; pause background loops and offline transport.
- On 401 refresh session once, then pause with sign-in notice. On 403/deleting/suspended stop private sync and prevent infinite retries. On validation error retain record and surface correction. No silent deletion of rejected local activity.
- On VERSION_CONFLICT record local intent and server snapshot. User selects Use account or Apply mine. Apply mine generates a new request against the refreshed version, with a new mutation ID. If server deleted, never resurrect the same ID; offer discard or explicit new private replacement.

## Pull and cursor safety

`pull_changes(after_revision, limit <= 500)` reads immutable per-owner change snapshots in revision order and returns next_revision and has_more. Use a consistent query snapshot per page. Each revision has one snapshot. The serial per-owner transaction lock ensures revisions commit in order; a rolled-back transaction does not create a committed gap that can hide later writes. A cursor is a decimal string, never a JS floating-point number.

For each page, SQLite applies snapshots and advances cursor in the same transaction. Ignore a snapshot older than the locally accepted record version, but still advance the page cursor. Preserve local pending projection. Repeat while has_more; safe to repeat a page after crash. A second device starting with revision 0 reconstructs current records from the change history, including deletions. Account deletion clears cursor/state entirely.

This protocol deliberately avoids `updated_at > last_seen_time`, which can miss equal timestamps and concurrent commits. Realtime is only a prompt to pull, never the synchronization ledger.

## Guest import

Guest mode has no cloud account/outbox transmission. Guest records have stable UUIDs. On consent to import, snapshot selected nondeleted guest entries and create durable per-record import jobs in the target account partition with stable mutation IDs. Each CREATE source=import, public epoch=null. Import can batch transport but uses independent per-record receipts/results.

After each accepted record, mark import acknowledged. Restart resumes unfinished jobs. On ENTITY_EXISTS for the same owner and identical imported content, count as already imported; mismatch creates a visible import conflict rather than overwriting. Another owner's UUID collision uses a newly generated destination UUID persisted in the import mapping. Guest records remain unchanged until all selected records are verified and the user chooses cleanup. Do not import the same guest partition automatically into a second account.

## Required failure scenarios

Transport accepted but response dropped; crash after local commit; crash after server accept before local ACK; crash during pull before cursor commit; create followed immediately by edit/undo while offline; two devices edit version 1; edit races deletion; same mutation ID with changed quantity; server timestamps tie; a long transaction followed by another write; consent disabled during offline queue; account switched during in-flight response; import restarted twice. Assign real SQLite/Postgres tests, not only reference-model tests.
