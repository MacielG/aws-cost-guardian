#!/usr/bin/env node

/**
 * Health Monitor Script for Cost Guardian
 * Monitors API endpoints and sends alerts if services are down
 * Usage: node health-monitor.js [api-url] [interval-seconds]
 * Example: node health-monitor.js https://api-endpoint/dev 60
 */

const https = require('https');
const http = require('http');

class HealthMonitor {
  constructor(apiUrl, intervalSeconds = 60) {
    this.apiUrl = apiUrl.replace(/\/$/, '');
    this.intervalSeconds = intervalSeconds;
    this.isHealthy = true;
    this.lastCheck = null;
    this.failures = 0;
    this.maxFailures = 3; // Alert after 3 consecutive failures
  }

  async checkEndpoint(endpoint, expectedStatus = 200) {
    return new Promise((resolve) => {
      const url = `${this.apiUrl}${endpoint}`;
      const startTime = Date.now();

      const client = url.startsWith('https:') ? https : http;
      const req = client.get(url, { timeout: 10000 }, (res) => {
        const duration = Date.now() - startTime;

        if (res.statusCode === expectedStatus) {
          resolve({ healthy: true, duration, status: res.statusCode, endpoint });
        } else {
          resolve({ healthy: false, duration, status: res.statusCode, endpoint });
        }
      });

      req.on('error', (err) => {
        const duration = Date.now() - startTime;
        resolve({ healthy: false, duration, status: 0, endpoint, error: err.message });
      });

      req.on('timeout', () => {
        req.abort();
        resolve({ healthy: false, duration: 10000, status: 0, endpoint, error: 'timeout' });
      });
    });
  }

  async performHealthCheck() {
    const endpoints = [
      { path: '/health', expected: 200 },
      { path: '/api/health', expected: 200 },
      { path: '/api/public/metrics', expected: 200 },
      { path: '/api/onboard-init', expected: 401 }, // Should return 401 (unauthorized)
      { path: '/api/system-status/aws', expected: 401 }, // Should return 401
    ];

    console.log(`🔍 Health Check - ${new Date().toISOString()}`);
    console.log(`📍 Target: ${this.apiUrl}`);

    const results = [];
    for (const endpoint of endpoints) {
      const result = await this.checkEndpoint(endpoint.path, endpoint.expected);
      results.push(result);

      const status = result.healthy ? '✅' : '❌';
      const duration = result.duration < 1000 ? `${result.duration}ms` : `${(result.duration/1000).toFixed(1)}s`;

      console.log(`${status} ${endpoint.path}: ${result.status} (${duration})`);
      if (!result.healthy && result.error) {
        console.log(`   Error: ${result.error}`);
      }
    }

    const allHealthy = results.every(r => r.healthy);
    this.lastCheck = new Date();

    if (allHealthy) {
      if (!this.isHealthy) {
        console.log('🎉 Services are back online!');
        this.isHealthy = true;
        this.failures = 0;
      } else {
        console.log('✅ All services healthy');
      }
    } else {
      this.failures++;
      const failedCount = results.filter(r => !r.healthy).length;

      if (this.isHealthy && this.failures >= this.maxFailures) {
        console.log(`🚨 ALERT: ${failedCount} service(s) failing for ${this.failures} consecutive checks!`);
        this.isHealthy = false;
        // Here you could send notifications (SNS, Slack, etc.)
      } else if (!this.isHealthy) {
        console.log(`❌ Services still failing (${this.failures} consecutive checks)`);
      }
    }

    console.log('─'.repeat(50));
  }

  start() {
    console.log(`🏥 Starting Health Monitor`);
    console.log(`📊 Interval: ${this.intervalSeconds} seconds`);
    console.log(`🚨 Alert threshold: ${this.maxFailures} consecutive failures`);
    console.log('─'.repeat(50));

    // Initial check
    this.performHealthCheck();

    // Schedule recurring checks
    setInterval(() => {
      this.performHealthCheck();
    }, this.intervalSeconds * 1000);
  }

  stop() {
    console.log('🛑 Stopping Health Monitor');
    process.exit(0);
  }
}

// CLI interface
const args = process.argv.slice(2);
const apiUrl = args[0] || 'http://localhost:3001/dev';
const intervalSeconds = parseInt(args[1]) || 60;

const monitor = new HealthMonitor(apiUrl, intervalSeconds);

// Handle graceful shutdown
process.on('SIGINT', () => monitor.stop());
process.on('SIGTERM', () => monitor.stop());

monitor.start();
