import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserLastActive1790000002000 implements MigrationInterface {
  name = 'AddUserLastActive1790000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" ADD "lastActiveAt" datetime`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "lastActiveAt"`);
  }
}
