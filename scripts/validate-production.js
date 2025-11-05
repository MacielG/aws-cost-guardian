#!/usr/bin/env node

/**
 * Production Validation Script
 * Validates that all required configurations are in place before deployment
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

class ProductionValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.successes = [];
  }

  log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = {
      info: 'ℹ️ ',
      success: '✅',
      warning: '⚠️ ',
      error: '❌'
    }[type] || 'ℹ️ ';

    console.log(`[${timestamp}] ${prefix} ${message}`);

    if (type === 'success') this.successes.push(message);
    if (type === 'warning') this.warnings.push(message);
    if (type === 'error') this.errors.push(message);
  }

  async checkFileExists(filePath, description) {
    try {
      await fs.promises.access(filePath);
      this.log(`${description} found: ${filePath}`, 'success');
      return true;
    } catch {
      this.log(`${description} missing: ${filePath}`, 'error');
      return false;
    }
  }

  async checkEnvironmentVariables() {
    this.log('Checking environment variables...');

    const required = [
      'AWS_REGION',
      'DYNAMODB_TABLE',
      'USER_POOL_ID',
      'USER_POOL_CLIENT_ID'
    ];

    const optional = [
      'STRIPE_SECRET_ARN',
      'STRIPE_PRO_PLAN_PRICE_ID',
      'FRONTEND_URL'
    ];

    let allPresent = true;

    for (const env of required) {
      if (process.env[env]) {
        this.log(`Required env var present: ${env}`, 'success');
      } else {
        this.log(`Required env var missing: ${env}`, 'error');
        allPresent = false;
      }
    }

    for (const env of optional) {
      if (process.env[env]) {
        this.log(`Optional env var present: ${env}`, 'success');
      } else {
        this.log(`Optional env var missing: ${env} (will use defaults)`, 'warning');
      }
    }

    return allPresent;
  }

  async checkDependencies() {
    this.log('Checking dependencies...');

    const packageJson = path.join(__dirname, '..', 'backend', 'package.json');
    const lockFile = path.join(__dirname, '..', 'backend', 'package-lock.json');

    await this.checkFileExists(packageJson, 'Backend package.json');
    await this.checkFileExists(lockFile, 'Backend package-lock.json');

    try {
      const pkg = JSON.parse(await fs.promises.readFile(packageJson, 'utf8'));
      const deps = Object.keys(pkg.dependencies || {});
      const devDeps = Object.keys(pkg.devDependencies || {});

      this.log(`Found ${deps.length} dependencies and ${devDeps.length} dev dependencies`, 'success');
    } catch (error) {
      this.log(`Error reading package.json: ${error.message}`, 'error');
    }
  }

  async checkInfrastructureConfig() {
    this.log('Checking infrastructure configuration...');

    const cdkConfig = path.join(__dirname, '..', 'infra', 'lib', 'cost-guardian-stack.ts');
    const serverlessConfig = path.join(__dirname, '..', 'backend', 'serverless.yml');

    await this.checkFileExists(cdkConfig, 'CDK stack configuration');
    await this.checkFileExists(serverlessConfig, 'Serverless configuration');

    // Check if CDK stack has required configurations
    try {
      const cdkContent = await fs.promises.readFile(cdkConfig, 'utf8');

      const checks = [
        { pattern: /DynamoDB/, description: 'DynamoDB configuration' },
        { pattern: /Cognito/i, description: 'Cognito configuration' },
        { pattern: /API Gateway/i, description: 'API Gateway configuration' },
        { pattern: /CloudWatch/, description: 'CloudWatch monitoring' },
        { pattern: /Lambda/, description: 'Lambda functions' }
      ];

      for (const check of checks) {
        if (cdkContent.includes(check.pattern.source)) {
          this.log(`${check.description} found in CDK config`, 'success');
        } else {
          this.log(`${check.description} not found in CDK config`, 'warning');
        }
      }
    } catch (error) {
      this.log(`Error reading CDK config: ${error.message}`, 'error');
    }
  }

  async testApiConnectivity(apiUrl) {
    if (!apiUrl) {
      this.log('No API URL provided, skipping connectivity test', 'warning');
      return;
    }

    this.log(`Testing API connectivity: ${apiUrl}`);

    try {
      const result = await this.makeRequest(`${apiUrl}/health`);
      if (result.status === 200) {
        this.log('API connectivity successful', 'success');
      } else {
        this.log(`API returned status ${result.status}`, 'warning');
      }
    } catch (error) {
      this.log(`API connectivity failed: ${error.message}`, 'error');
    }
  }

  makeRequest(url) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https:') ? https : require('http');
      const req = client.get(url, { timeout: 5000 }, (res) => {
        resolve({ status: res.statusCode });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.abort();
        reject(new Error('Request timeout'));
      });
    });
  }

  async runValidation() {
    console.log('🚀 Starting Production Validation');
    console.log('═'.repeat(60));

    // Run all checks
    await this.checkEnvironmentVariables();
    await this.checkDependencies();
    await this.checkInfrastructureConfig();

    // Test API if URL is provided
    const apiUrl = process.env.FRONTEND_URL?.replace(/\/$/, '') ||
                   `https://0zf1mthfa8.execute-api.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/dev`;
    await this.testApiConnectivity(apiUrl);

    console.log('═'.repeat(60));
    console.log('📊 VALIDATION SUMMARY');
    console.log(`✅ Successes: ${this.successes.length}`);
    console.log(`⚠️  Warnings: ${this.warnings.length}`);
    console.log(`❌ Errors: ${this.errors.length}`);

    if (this.errors.length === 0) {
      console.log('🎉 Validation passed! Ready for production deployment.');
      process.exit(0);
    } else {
      console.log('❌ Validation failed! Please fix errors before deploying.');
      console.log('\n📋 ERRORS FOUND:');
      this.errors.forEach(error => console.log(`  • ${error}`));
      process.exit(1);
    }
  }
}

// Run validation
const validator = new ProductionValidator();
validator.runValidation().catch(error => {
  console.error('Validation script failed:', error);
  process.exit(1);
});
