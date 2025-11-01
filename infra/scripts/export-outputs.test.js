// export-outputs.test.js

const { loadExistingEnv, areEnvsEqual } = require('./export-outputs');

describe('export-outputs helpers', () => {
  test('loadExistingEnv parses .env.local correctly', () => {
    // Mock fs
    const fs = require('fs');
    const originalExistsSync = fs.existsSync;
    const originalReadFileSync = fs.readFileSync;

    fs.existsSync = jest.fn(() => true);
    fs.readFileSync = jest.fn(() => 'NEXT_PUBLIC_API_URL=test\n# Comment\nNEXT_PUBLIC_REGION=us-east-1\n');

    const env = loadExistingEnv();
    expect(env).toEqual({
      NEXT_PUBLIC_API_URL: 'test',
      NEXT_PUBLIC_REGION: 'us-east-1'
    });

    fs.existsSync = originalExistsSync;
    fs.readFileSync = originalReadFileSync;
  });

  test('areEnvsEqual compares environments correctly', () => {
    const env1 = { A: '1', B: '2' };
    const env2 = { A: '1', B: '2' };
    const env3 = { A: '1', B: '3' };

    expect(areEnvsEqual(env1, env2)).toBe(true);
    expect(areEnvsEqual(env1, env3)).toBe(false);
  });
});
