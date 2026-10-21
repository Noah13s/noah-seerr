import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSeasonProgress1790000001000 implements MigrationInterface {
  name = 'AddSeasonProgress1790000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "watch_history" ADD "seasonProgress" text`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "watch_history" DROP COLUMN "seasonProgress"`
    );
  }
}
