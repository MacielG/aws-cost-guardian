// Jest setup específico para testes da infra
process.env.NODE_ENV = 'test';

// Mock de funções globais
global.fetch = jest.fn();
global.console = {
  ...console,
  // Silencia logs durante os testes mas mantém erros e warnings
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  error: console.error,
  warn: console.warn,
};

// Reseta todos os mocks entre testes
afterEach(() => {
  jest.clearAllMocks();
});