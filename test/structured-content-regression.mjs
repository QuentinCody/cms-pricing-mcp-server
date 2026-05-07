#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '..');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assertContains(filePath, haystack, needle, testName) {
  totalTests++;
  if (haystack.includes(needle)) {
    console.log(`${GREEN}✓${RESET} ${testName}`);
    passedTests++;
  } else {
    console.log(`${RED}✗${RESET} ${testName}`);
    console.log(`  Missing: ${needle}`);
    console.log(`  File: ${filePath}`);
    failedTests++;
  }
}

function readFile(relPath) {
  const absPath = path.resolve(SERVER_ROOT, relPath);
  return fs.readFileSync(absPath, 'utf8');
}

console.log(`${BLUE}CMS Pricing Structured Content Regression Tests${RESET}`);

const indexContent = readFile('src/index.ts');
assertContains('src/index.ts', indexContent, 'CmsPricingDataDO', 'index.ts exports CmsPricingDataDO');
assertContains('src/index.ts', indexContent, 'McpAgent', 'index.ts uses McpAgent');
assertContains('src/index.ts', indexContent, 'registerCodeMode', 'index.ts registers Code Mode');
assertContains('src/index.ts', indexContent, 'registerQueryData', 'index.ts registers query-data');
assertContains('src/index.ts', indexContent, 'registerGetSchema', 'index.ts registers get-schema');

const doContent = readFile('src/do.ts');
assertContains('src/do.ts', doContent, 'RestStagingDO', 'do.ts extends RestStagingDO');
assertContains('src/do.ts', doContent, 'CmsPricingDataDO', 'do.ts exports CmsPricingDataDO');

const catalogContent = readFile('src/spec/catalog.ts');
assertContains('src/spec/catalog.ts', catalogContent, 'cmsPricingCatalog', 'catalog.ts exports cmsPricingCatalog');

const adapterContent = readFile('src/lib/api-adapter.ts');
assertContains('src/lib/api-adapter.ts', adapterContent, 'createCmsPricingApiFetch', 'api-adapter.ts exports createCmsPricingApiFetch');

const codeModeContent = readFile('src/tools/code-mode.ts');
assertContains('src/tools/code-mode.ts', codeModeContent, 'createSearchTool', 'code-mode.ts uses createSearchTool');
assertContains('src/tools/code-mode.ts', codeModeContent, 'createExecuteTool', 'code-mode.ts uses createExecuteTool');
assertContains('src/tools/code-mode.ts', codeModeContent, '"cms_pricing"', 'code-mode.ts uses cms_pricing prefix');

console.log(`\n${BLUE}Test Results Summary${RESET}`);
console.log(`Total tests: ${totalTests}`);
console.log(`${GREEN}Passed: ${passedTests}${RESET}`);
console.log(`${RED}Failed: ${failedTests}${RESET}`);

if (failedTests > 0) {
  console.log(`\n${RED}Regression tests failed.${RESET}`);
  process.exit(1);
}

console.log(`\n${GREEN}CMS Pricing structured content regression tests passed.${RESET}`);
