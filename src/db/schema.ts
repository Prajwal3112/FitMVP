import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// ─── Events ──────────────────────────────────────────────────────────
// Append-only event log. The truth.
// Every domain change is an event. Projections are derived from events.

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),                       // ulid
    seq: integer('seq').notNull().unique(),            // monotonic, gapless
    type: text('type').notNull(),                      // discriminator (e.g., 'UserContextCreated')
    occurredAt: text('occurred_at').notNull(),         // ISO 8601 UTC
    trainingDay: text('training_day').notNull(),       // YYYY-MM-DD per user's rollover hour
    payloadJson: text('payload_json').notNull(),       // serialized event payload
    schemaVersion: integer('schema_version').notNull(),
    prevHash: text('prev_hash').notNull(),             // sha256(prev.id + JSON(prev.payload))
  },
  (table) => ({
    seqIdx: index('events_seq_idx').on(table.seq),
    typeIdx: index('events_type_idx').on(table.type),
    trainingDayIdx: index('events_training_day_idx').on(table.trainingDay),
  }),
);

export type EventRow = typeof events.$inferSelect;
export type EventInsert = typeof events.$inferInsert;

// ─── Projections ─────────────────────────────────────────────────────
// Derived state cache. Always recomputable from events.
// Each row is one named projection (e.g., 'UserContext', 'ActivePlan').

export const projections = sqliteTable('projections', {
  name: text('name').primaryKey(),
  lastSeq: integer('last_seq').notNull(),              // last event seq folded into this projection
  stateJson: text('state_json').notNull(),             // serialized projection state
  updatedAt: text('updated_at').notNull(),
});

export type ProjectionRow = typeof projections.$inferSelect;
export type ProjectionInsert = typeof projections.$inferInsert;
