const { checkSLA } = require('../functions/sla-workflow');

describe('checkSLA', () => {
  test('returns no violation when impactedCost is 0', async () => {
    const event = { impactedCost: 0, healthEvent: { startTime: new Date().toISOString(), endTime: new Date().toISOString() }, slaThreshold: 0.999 };
    const result = await checkSLA(event);
    expect(result.violation).toBe(false);
    expect(result.credit).toBe(0);
  });

  test('calculates credit when duration exceeds SLA', async () => {
    const start = new Date(Date.now() - 1000 * 60 * 120).toISOString(); // 2 hours ago
    const end = new Date().toISOString();
    const event = { impactedCost: 100, healthEvent: { startTime: start, endTime: end, service: 'ec2' }, slaThreshold: 0.999 };
    const result = await checkSLA(event);
    // Com 2 horas de downtime e SLA muito estrito, espera-se violação
    expect(result.violation).toBe(true);
    expect(result.credit).toBeGreaterThan(0);
  });
});
