import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEpisodeOverrides1790000003000 implements MigrationInterface {
  name = 'AddEpisodeOverrides1790000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "watch_history" ADD COLUMN "episodeOverrides" text'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "watch_history" DROP COLUMN "episodeOverrides"'
    );
  }
}
