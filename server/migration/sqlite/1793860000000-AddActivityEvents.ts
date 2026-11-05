import type { MigrationInterface, QueryRunner } from 'typeorm';
export class AddActivityEvents1793860000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE TABLE "activity_event" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "userId" integer NOT NULL, "userName" varchar NOT NULL, "category" varchar NOT NULL, "action" varchar NOT NULL, "device" varchar NOT NULL, "title" varchar NOT NULL DEFAULT '', "details" text NOT NULL DEFAULT '{}', "createdAt" datetime NOT NULL DEFAULT CURRENT_TIMESTAMP)`
    );
    for (const column of ['userId', 'category', 'createdAt'])
      await q.query(
        `CREATE INDEX "IDX_activity_event_${column}" ON "activity_event" ("${column}")`
      );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE "activity_event"');
  }
}
