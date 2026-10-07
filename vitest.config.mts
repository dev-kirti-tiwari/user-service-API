import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['tests/global-setup.mts'],
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 120000,
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      BRR_TOKEN: 'test-brr-token-0123456789abcdef',
      MAX_PAGE_SIZE: '50',
      RATE_LIMIT_PER_MINUTE: '100000',
      GLOBAL_RATE_LIMIT_PER_MINUTE: '1000000',
      IDEMPOTENCY_TTL_HOURS: '24',
    },
  },
});
