import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSeasonProgress1790000001000 implements MigrationInterface {
  name = 'AddSeasonProgress1790000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "watch_history" ADD "seasonProgress" text`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_watch_history_status"`);
    await queryRunner.query(`DROP INDEX "IDX_watch_history_title"`);
    await queryRunner.query(`DROP INDEX "IDX_watch_history_tmdb"`);
    await queryRunner.query(`DROP INDEX "IDX_watch_history_user"`);
    await queryRunner.query(
      `CREATE TABLE "temporary_watch_history" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "mediaType" varchar NOT NULL, "tmdbId" integer, "title" varchar NOT NULL, "releaseYear" integer, "status" varchar NOT NULL DEFAULT ('planned'), "watchCount" integer NOT NULL DEFAULT (0), "watchedAt" datetime, "watchedEpisodes" integer, "totalEpisodes" integer, "categories" varchar, "rating" integer, "priority" integer, "series" varchar, "notes" text, "userId" integer, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP), CONSTRAINT "FK_watch_history_user" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
    );
    await queryRunner.query(
      `INSERT INTO "temporary_watch_history"("id", "mediaType", "tmdbId", "title", "releaseYear", "status", "watchCount", "watchedAt", "watchedEpisodes", "totalEpisodes", "categories", "rating", "priority", "series", "notes", "userId", "createdAt", "updatedAt") SELECT "id", "mediaType", "tmdbId", "title", "releaseYear", "status", "watchCount", "watchedAt", "watchedEpisodes", "totalEpisodes", "categories", "rating", "priority", "series", "notes", "userId", "createdAt", "updatedAt" FROM "watch_history"`
    );
    await queryRunner.query(`DROP TABLE "watch_history"`);
    await queryRunner.query(
      `ALTER TABLE "temporary_watch_history" RENAME TO "watch_history"`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_watch_history_user" ON "watch_history" ("userId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_watch_history_tmdb" ON "watch_history" ("tmdbId")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_watch_history_title" ON "watch_history" ("title")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_watch_history_status" ON "watch_history" ("status")`
    );
  }
}
