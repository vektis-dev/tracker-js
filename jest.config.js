/** @type {import('jest').Config} */
export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "jsdom",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: {
          target: "es2020",
          module: "esnext",
          moduleResolution: "bundler",
          esModuleInterop: true,
          isolatedModules: true,
          strict: true,
          lib: ["es2020", "dom", "dom.iterable"],
        },
      },
    ],
  },
  testMatch: ["<rootDir>/__tests__/**/*.test.ts"],
  testPathIgnorePatterns: process.env.TRACKER_INTEGRATION
    ? ["/node_modules/"]
    : ["/node_modules/", "/__tests__/integration.test.ts"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts"],
};
