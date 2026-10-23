import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    baseUrl: 'http://127.0.0.1:5055',
    specPattern: 'cypress/fixture/**/*.cy.ts',
    supportFile: false,
  },
  video: true,
  retries: 0,
  defaultCommandTimeout: 10000,
});
