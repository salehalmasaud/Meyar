import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'tests/browser',timeout:300000,expect:{timeout:20000},workers:1,retries:0,reporter:[['list']],use:{headless:true,trace:'off',video:'off',screenshot:'off',viewport:{width:1440,height:1000}}});
