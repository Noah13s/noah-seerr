import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddShowAnimePreference1790000002000 implements MigrationInterface {
  name = 'AddShowAnimePreference1790000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_settings" ADD "showAnime" boolean NOT NULL DEFAULT (1)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_settings" DROP COLUMN "showAnime"`
    );
  }
}
