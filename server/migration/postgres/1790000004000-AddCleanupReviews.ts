import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCleanupReviews1790000004000 implements MigrationInterface {
  name = 'AddCleanupReviews1790000004000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "cleanup_review" ("id" varchar PRIMARY KEY NOT NULL, "reviewKey" varchar NOT NULL UNIQUE, "mediaType" varchar NOT NULL, "tmdbId" integer NOT NULL, "seasonNumber" integer, "title" varchar NOT NULL, "fingerprint" varchar NOT NULL, "requesterNames" text NOT NULL DEFAULT ('[]'), "eligibleAt" TIMESTAMP NOT NULL, "status" varchar NOT NULL DEFAULT ('pending'), "planJson" text, "planHash" varchar, "notifiedAt" TIMESTAMP, "emailError" varchar, "decidedBy" integer, "decidedAt" TIMESTAMP, "lastError" text, "createdAt" TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP), "updatedAt" TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP))`
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_cleanup_review_status" ON "cleanup_review" ("status")'
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "cleanup_review"');
  }
}
