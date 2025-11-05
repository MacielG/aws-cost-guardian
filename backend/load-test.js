#!/usr/bin/env node

/**
 * Load Testing Script for Cost Guardian API
 * Usage: node load-test.js [endpoint] [concurrency] [requests]
 * Example: node load-test.js https://api-endpoint/dev 10 100
 */

const https = require('https');
const http = require('http');

class LoadTester {
  constructor(baseUrl, concurrency = 10, totalRequests = 100) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.concurrency = concurrency;
    this.totalRequests = totalRequests;
    this.completedRequests = 0;
    this.errors = 0;
    this.responseTimes = [];
    this.startTime = Date.now();
  }

  makeRequest(endpoint = '/health') {
    return new Promise((resolve, reject) => {
      const url = `${this.baseUrl}${endpoint}`;
      const startTime = Date.now();

      const client = url.startsWith('https:') ? https : http;
      const req = client.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const duration = Date.now() - startTime;
          this.responseTimes.push(duration);

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ status: res.statusCode, duration, endpoint });
          } else {
            this.errors++;
            resolve({ status: res.statusCode, duration, endpoint, error: true });
          }
        });
      });

      req.on('error', (err) => {
        const duration = Date.now() - startTime;
        this.responseTimes.push(duration);
        this.errors++;
        resolve({ status: 0, duration, endpoint, error: err.message });
      });

      req.setTimeout(30000, () => {
        req.abort();
        const duration = Date.now() - startTime;
        this.responseTimes.push(duration);
        this.errors++;
        resolve({ status: 0, duration, endpoint, error: 'timeout' });
      });
    });
  }

  async runLoadTest() {
    console.log(`🚀 Starting load test: ${this.totalRequests} requests with concurrency ${this.concurrency}`);
    console.log(`📍 Target: ${this.baseUrl}`);
    console.log('─'.repeat(60));

    const batches = [];
    for (let i = 0; i < this.totalRequests; i += this.concurrency) {
      batches.push(Math.min(this.concurrency, this.totalRequests - i));
    }

    let requestCount = 0;

    for (const batchSize of batches) {
      const promises = [];

      for (let i = 0; i < batchSize; i++) {
        requestCount++;
        // Mix of different endpoints for realistic testing
        const endpoints = ['/health', '/api/health', '/api/public/metrics'];
        const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];

        promises.push(this.makeRequest(endpoint));
      }

      await Promise.all(promises);

      // Progress indicator
      const progress = Math.round((requestCount / this.totalRequests) * 100);
      process.stdout.write(`\r📊 Progress: ${progress}% (${requestCount}/${this.totalRequests})`);

      // Small delay between batches to prevent overwhelming
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log('\n' + '─'.repeat(60));

    const totalTime = Date.now() - this.startTime;
    const avgResponseTime = this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;
    const minResponseTime = Math.min(...this.responseTimes);
    const maxResponseTime = Math.max(...this.responseTimes);
    const p95ResponseTime = this.responseTimes.sort((a, b) => a - b)[Math.floor(this.responseTimes.length * 0.95)];
    const requestsPerSecond = (this.totalRequests / totalTime) * 1000;

    console.log('📈 LOAD TEST RESULTS');
    console.log(`Total Requests: ${this.totalRequests}`);
    console.log(`Concurrency: ${this.concurrency}`);
    console.log(`Total Time: ${(totalTime / 1000).toFixed(2)}s`);
    console.log(`Requests/Second: ${requestsPerSecond.toFixed(2)}`);
    console.log(`Errors: ${this.errors} (${((this.errors / this.totalRequests) * 100).toFixed(2)}%)`);
    console.log('');
    console.log('⏱️  RESPONSE TIMES');
    console.log(`Average: ${avgResponseTime.toFixed(2)}ms`);
    console.log(`Min: ${minResponseTime}ms`);
    console.log(`Max: ${maxResponseTime}ms`);
    console.log(`95th Percentile: ${p95ResponseTime}ms`);

    // Performance assessment
    console.log('');
    console.log('🎯 PERFORMANCE ASSESSMENT');
    if (requestsPerSecond > 100) {
      console.log('✅ Excellent performance!');
    } else if (requestsPerSecond > 50) {
      console.log('👍 Good performance');
    } else if (requestsPerSecond > 20) {
      console.log('⚠️  Acceptable performance');
    } else {
      console.log('❌ Poor performance - consider optimization');
    }

    if (p95ResponseTime < 1000) {
      console.log('✅ Fast response times');
    } else if (p95ResponseTime < 3000) {
      console.log('⚠️  Moderate response times');
    } else {
      console.log('❌ Slow response times');
    }

    if (this.errors === 0) {
      console.log('✅ No errors detected');
    } else if (this.errors / this.totalRequests < 0.01) {
      console.log('⚠️  Low error rate acceptable');
    } else {
      console.log('❌ High error rate - investigate issues');
    }
  }
}

// CLI interface
const args = process.argv.slice(2);
const baseUrl = args[0] || 'http://localhost:3001/dev';
const concurrency = parseInt(args[1]) || 10;
const totalRequests = parseInt(args[2]) || 100;

const tester = new LoadTester(baseUrl, concurrency, totalRequests);
tester.runLoadTest().catch(console.error);
