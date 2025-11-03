const { joinUrl } = require('../frontend/lib/url');

const cases = [
  { base: 'https://api.example.com/prod/', path: '/recommendations', expected: 'https://api.example.com/prod/recommendations' },
  { base: 'https://api.example.com/prod', path: 'recommendations', expected: 'https://api.example.com/prod/recommendations' },
  { base: 'https://api.example.com/', path: '/api/', expected: 'https://api.example.com/api' },
  { base: 'http://localhost:3001', path: '/api/health', expected: 'http://localhost:3001/api/health' },
  { base: 'http://localhost:3001/', path: '', expected: 'http://localhost:3001' },
  { base: '', path: '/foo', expected: '/foo' },
];

let failed = 0;
cases.forEach(({ base, path, expected }, i) => {
  const got = joinUrl(base, path);
  const ok = got === expected;
  console.log(`#${i + 1} base='${base}' path='${path}' -> '${got}' ${ok ? 'OK' : `FAIL (expected ${expected})`}`);
  if (!ok) failed++;
});

if (failed > 0) {
  console.error(`\n${failed} tests failed`);
  process.exit(2);
}

console.log('\nAll tests passed');
