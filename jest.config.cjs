module.exports = {
  rootDir: process.cwd(),
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: `${process.cwd()}/tsconfig.json` }] },
  testMatch: ['**/?(*.)+(spec).ts'],
};
