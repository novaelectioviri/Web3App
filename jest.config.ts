import type { Config } from 'jest';

const config: Config = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/tests/**/*.spec.ts'],
    testPathIgnorePatterns: ['/node_modules/', '/frontend/'],
};

export default config;
