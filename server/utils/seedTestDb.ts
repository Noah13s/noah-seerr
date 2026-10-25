import { UserType } from '@server/constants/user';
import dataSource, { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import bcrypt from 'bcrypt';
import gravatarUrl from 'gravatar-url';

export interface SeedDbOptions {
  /** If true, preserves existing data instead of dropping the database */
  preserveDb?: boolean;
  /** If true, runs migrations instead of synchronizing schema */
  withMigrations?: boolean;
  /** If true, permits seeding while NODE_ENV is not test */
  allowOutsideTest?: boolean;
}

// Test/demo accounts intentionally use a known fixture password. Generate a
// freshly salted hash per process instead of committing a reusable hash.
let testPasswordHash: Promise<string> | undefined;

function assertTestDatabase(operation: string, allowOutsideTest = false): void {
  if (allowOutsideTest || process.env.NODE_ENV === 'test') {
    return;
  }

  throw new Error(
    `Refusing to ${operation} while NODE_ENV is not test: this drops every table and seeds accounts with a known password.`
  );
}

/**
 * Seeds test users into the database.
 * Assumes the database schema is already set up.
 */
export async function seedTestUsers(allowOutsideTest = false): Promise<void> {
  assertTestDatabase('seed test users', allowOutsideTest);
  testPasswordHash ??= bcrypt.hash('test1234', 12);
  const passwordHash = await testPasswordHash;
  const userRepository = getRepository(User);

  const admin = await userRepository.findOne({
    select: { id: true, plexId: true },
    where: { id: 1 },
  });

  // Create the admin user
  const user =
    (await userRepository.findOne({
      where: { email: 'admin@seerr.dev' },
    })) ?? new User();
  user.plexId = admin?.plexId ?? 1;
  user.plexToken = '1234';
  user.plexUsername = 'admin';
  user.username = 'admin';
  user.email = 'admin@seerr.dev';
  user.userType = UserType.PLEX;
  user.password = passwordHash;
  user.permissions = 2;
  user.avatar = gravatarUrl('admin@seerr.dev', { default: 'mm', size: 200 });
  await userRepository.save(user);

  // Create the other user
  const otherUser =
    (await userRepository.findOne({
      where: { email: 'demo@seerr.dev' },
    })) ?? new User();
  otherUser.plexId = admin?.plexId ?? 1;
  otherUser.plexToken = '1234';
  otherUser.plexUsername = 'demo';
  otherUser.username = 'demo';
  otherUser.email = 'demo@seerr.dev';
  otherUser.userType = UserType.PLEX;
  otherUser.password = passwordHash;
  otherUser.permissions = 32;
  otherUser.avatar = gravatarUrl('demo@seerr.dev', {
    default: 'mm',
    size: 200,
  });
  await userRepository.save(otherUser);
}

/**
 * Initializes the database connection and seeds test users.
 * Used by both Cypress tests and Vitest unit tests.
 */
export async function seedTestDb(options: SeedDbOptions = {}): Promise<void> {
  assertTestDatabase('seed the test database', options.allowOutsideTest);

  const dbConnection = dataSource.isInitialized
    ? dataSource
    : await dataSource.initialize();

  if (!options.preserveDb) {
    await dbConnection.dropDatabase();
  }

  if (options.withMigrations) {
    await dbConnection.runMigrations();
  } else {
    await dbConnection.synchronize();
  }

  await seedTestUsers(options.allowOutsideTest);
}

/**
 * Resets the database to a clean state with seeded test users.
 * Used between tests to ensure isolation.
 * Assumes DB has been initialized.
 */
export async function resetTestDb(): Promise<void> {
  assertTestDatabase('reset the test database');

  await dataSource.synchronize(true);
  await seedTestUsers();
}
