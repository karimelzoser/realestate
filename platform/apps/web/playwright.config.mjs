import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./e2e',fullyParallel:false,workers:1,retries:0,timeout:60000,
  use:{baseURL:process.env.E07_WEB_URL??'http://127.0.0.1:3030',browserName:'chromium',viewport:{width:1440,height:1000},
    screenshot:'only-on-failure',trace:'retain-on-failure'},
  reporter:'list',outputDir:'test-results',
});
