import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddViewingProgress1790000005000 implements MigrationInterface {
  name = 'AddViewingProgress1790000005000';
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "watch_history" ADD COLUMN "viewingProgress" text'
    );
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "watch_history" DROP COLUMN "viewingProgress"'
    );
  }
}
