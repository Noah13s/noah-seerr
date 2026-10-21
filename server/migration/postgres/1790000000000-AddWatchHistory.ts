import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWatchHistory1790000000000 implements MigrationInterface {
  name = 'AddWatchHistory1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "watch_history" ("id" SERIAL NOT NULL, "mediaType" character varying NOT NULL, "tmdbId" integer, "title" character varying NOT NULL, "releaseYear" integer, "status" character varying NOT NULL DEFAULT 'planned', "watchCount" integer NOT NULL DEFAULT 0, "watchedAt" TIMESTAMP, "watchedEpisodes" integer, "totalEpisodes" integer, "categories" character varying, "rating" integer, "priority" integer, "series" character varying, "notes" text, "userId" integer, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_watch_history" PRIMARY KEY ("id"), CONSTRAINT "FK_watch_history_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION)`
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "watch_history"`);
  }
}
