import type { Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({ dir: "./" });

const config: Config = {
  coverageProvider: "v8",
  testEnvironment: "jsdom",

  setupFilesAfterEnv: [
    "@testing-library/jest-dom",
  ],

  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^maplibre-gl$": "<rootDir>/src/__mocks__/maplibre-gl.ts",
  },

  testPathIgnorePatterns: [
    "<rootDir>/node_modules/",
    "<rootDir>/.next/",
  ],
};

export default createJestConfig(config);