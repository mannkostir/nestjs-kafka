const moduleNameMapper = {
  '^(\\.{1,2}/.*)\\.js$': '$1',
};

module.exports = {
  projects: [
    {
      displayName: 'unit',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
      moduleNameMapper,
    },
    {
      displayName: 'integration',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],
      moduleNameMapper,
    },
  ],
};
