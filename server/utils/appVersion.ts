import logger from '@server/logger';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

const COMMIT_TAG_PATH = path.join(__dirname, '../../committag.json');
let commitTag = 'local';

if (existsSync(COMMIT_TAG_PATH)) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  commitTag = require(COMMIT_TAG_PATH).commitTag;
  logger.info(`Commit Tag: ${commitTag}`);
}

export const getCommitTag = (): string => {
  return commitTag;
};

export function readFrontendBuildId(
  filename = path.join(__dirname, '../../.next/BUILD_ID'),
  production = process.env.NODE_ENV === 'production'
): string | undefined {
  if (!production) return undefined;
  try {
    const value = readFileSync(filename, 'utf8').trim();
    return /^[a-zA-Z0-9_-]{1,160}$/.test(value) && value !== 'development'
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

const frontendBuildId = readFrontendBuildId();
export const getFrontendBuildId = (): string | undefined => frontendBuildId;

export const getAppVersion = (): string => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { version } = require('../../package.json');

  let finalVersion = version;

  if (version === '0.1.0') {
    finalVersion = `develop-${getCommitTag()}`;
  }

  return finalVersion;
};
