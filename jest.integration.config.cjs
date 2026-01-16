module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/**/*.integration.test.mjs', '<rootDir>/**/*.integration.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.base.json' }] },
};
