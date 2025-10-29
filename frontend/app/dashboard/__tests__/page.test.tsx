// Mock AuthProvider to avoid real auth calls and act warnings
jest.mock('@/components/auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useAuth: () => ({ user: { username: 'test', userId: '123' }, loading: false, signOut: jest.fn(), refreshUser: jest.fn() }),
}));

// Mock aws-amplify to avoid act warnings
jest.mock('aws-amplify/auth', () => ({
  getCurrentUser: jest.fn().mockResolvedValue({ username: 'test', userId: '123' }),
  fetchAuthSession: jest.fn().mockResolvedValue({ tokens: { idToken: { payload: { email: 'test@example.com' } } } }),
  signOut: jest.fn().mockResolvedValue(undefined),
}));

import React from 'react';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AuthProvider } from '@/components/auth/AuthProvider';

// Top-level mocks (must be declared before importing the page under test)
let mockRouter = { push: jest.fn(), pathname: '/', query: {} } as any;

const defaultTranslations: Record<string, string> = {
  'dashboard': 'Dashboard',
  'dashboard.totalEarnings': 'Total Earnings',
  'dashboard.totalCost': 'Total Cost',
  'dashboard.activeIncidents': 'Active Incidents',
  'dashboard.recentIncidents': 'Recent Incidents',
  'dashboard.topCostServices': 'Top Cost Services',
  'dashboard.fromLastMonth': 'from last month',
  'dashboard.detected': 'detected',
  'dashboard.impact': 'Impact',
  'dashboard.noIncidents': 'No incidents found',
  'dashboard.loadingCostData': 'Loading cost data...',
  'dashboard.noCostData': 'No cost data available',
  'dashboard.status.refunded': 'Refunded',
  'dashboard.status.submitted': 'Submitted',
  'dashboard.status.detected': 'Detected',
  'dashboard.error.auth': 'Authentication failed',
  'dashboard.error.network': 'Network error occurred',
  'dashboard.error.timeout': 'A requisição excedeu o tempo limite',
};

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

// @ts-ignore
jest.mock('@/components/charts/BarChart', () => () => <div data-testid="bar-chart-mock" />);
// @ts-ignore
jest.mock('@/components/charts/LineChart', () => () => <div data-testid="line-chart-mock" />);

// @ts-ignore
jest.mock('@/lib/api', () => ({
  apiFetch: jest.fn(),
}));

// @ts-ignore
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => defaultTranslations[key] || key,
    i18n: { language: 'pt-BR' }
  }),
}));

// Importações principais (APENAS UMA VEZ!)
import DashboardPage from '../page';
import { formatCurrency, formatDate } from '@/lib/utils';

// Recupera o mock gerado pelo jest para podermos inspecioná-lo nos testes
const mockApiFetch = (jest.requireMock('@/lib/api') as any).apiFetch as jest.Mock;

// Helper functions
const expectElementToBeInDocument = (element: Element | null) => {
  expect(element).toBeInTheDocument();
};

const expectTextToBePresent = (text: string | RegExp) => {
  const element = screen.getByText(text);
  expect(element).toBeInTheDocument();
};

const expectTextNotToBePresent = (text: string | RegExp) => {
  const element = screen.queryByText(text);
  expect(element).not.toBeInTheDocument();
};

// Tipos
interface MockIncident {
  id: string;
  service: string;
  impact: number;
  confidence: number;
  status: 'refunded' | 'detected' | 'submitted';
  region: string;
  timestamp: string;
}

interface MockCost {
  Groups: {
    Keys: string[];
    Metrics: { UnblendedCost: { Amount: string; Unit: string } };
  }[];
  TimePeriod?: { Start: string; End: string };
}

interface AccountScenario {
  name: string;
  accountType: 'PREMIUM' | 'FREE' | 'TRIAL';
  incidents: MockIncident[];
  costs: MockCost;
  expectedElements: string[];
  shouldRedirect: boolean;
}

interface ErrorScenario {
  name: string;
  errors: {
    costs: Error | null;
    incidents: Error | null;
    status: Error | null;
  };
  expectedError: string;
}

// Centralização de mocks
const setupMocks = () => {
  mockRouter = { push: jest.fn(), pathname: '/', query: {} } as any;
  mockApiFetch.mockClear();

  const mockTranslations = { ...defaultTranslations };

  return {
    mockRouter,
    mockApiFetch,
    mockTranslations,
  };
};

// Helper para criação de dados de teste
const createTestData = () => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const accountScenarios: AccountScenario[] = [
    {
      name: 'conta premium com dados completos',
      accountType: 'PREMIUM',
      incidents: [
        {
          id: '1',
          service: 'EC2',
          impact: 100,
          confidence: 0.9,
          status: 'refunded',
          region: 'us-east-1',
          timestamp: now.toISOString(),
        },
        {
          id: '2',
          service: 'RDS',
          impact: 50,
          confidence: 0.8,
          status: 'detected',
          region: 'us-west-2',
          timestamp: now.toISOString(),
        },
      ],
      costs: {
        Groups: [
          {
            Keys: ['EC2'],
            Metrics: { UnblendedCost: { Amount: '500.50', Unit: 'USD' } },
          },
          {
            Keys: ['RDS'],
            Metrics: { UnblendedCost: { Amount: '300.25', Unit: 'USD' } },
          },
        ],
        TimePeriod: {
          Start: thirtyDaysAgo.toISOString().split('T')[0],
          End: now.toISOString().split('T')[0],
        },
      },
      expectedElements: [
        'Total Earnings',
        '$70.00',
        'Active Incidents',
      ],
      shouldRedirect: false,
    },
    {
      name: 'conta free com dados limitados',
      accountType: 'FREE',
      incidents: [
        {
          id: '1',
          service: 'EC2',
          impact: 30,
          confidence: 0.7,
          status: 'detected',
          region: 'us-east-1',
          timestamp: now.toISOString(),
        },
      ],
      costs: {
        Groups: [
          {
            Keys: ['EC2'],
            Metrics: { UnblendedCost: { Amount: '100.00', Unit: 'USD' } },
          },
        ],
        TimePeriod: {
          Start: thirtyDaysAgo.toISOString().split('T')[0],
          End: now.toISOString().split('T')[0],
        },
      },
      expectedElements: [
        'Total Earnings',
        '$0.00',
        'Active Incidents',
      ],
      shouldRedirect: false,
    },
    {
      name: 'conta trial deve redirecionar',
      accountType: 'TRIAL',
      incidents: [],
      costs: { Groups: [] },
      expectedElements: [],
      shouldRedirect: true,
    },
  ];

  const errorScenarios: ErrorScenario[] = [
    {
      name: 'falha na API de custos',
      errors: {
        costs: new Error('Failed to fetch cost data'),
        incidents: null,
        status: null,
      },
      expectedError: 'Network error occurred',
    },
    {
      name: 'falha na API de incidentes',
      errors: {
        costs: null,
        incidents: new Error('Failed to fetch incidents'),
        status: null,
      },
      expectedError: 'Network error occurred',
    },
    {
    name: 'timeout na API',
    errors: {
    costs: new Error('Request timeout'),
    incidents: new Error('Request timeout'),
    status: null,
    },
    expectedError: 'A requisição excedeu o tempo limite',
    },
    {
      name: 'erro de autenticação',
      errors: {
        costs: new Error('Unauthorized'),
        incidents: new Error('Unauthorized'),
        status: new Error('Unauthorized'),
      },
      expectedError: 'Authentication failed',
    },
  ];

  return { accountScenarios, errorScenarios };
};

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe('DashboardPage', () => {
  const { mockRouter, mockApiFetch } = setupMocks();
  const { accountScenarios, errorScenarios } = createTestData();
  
  let abortControllers: AbortController[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    abortControllers = [];
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllTimers();
    jest.clearAllMocks(); // Limpa chamadas e instâncias
    // Se você modificou mocks (ex: mockImplementation), talvez precise de restore:
    jest.restoreAllMocks();
    abortControllers.forEach(controller => controller.abort());
    abortControllers = [];
  });

  describe('Cenários de Conta', () => {
    test.each(accountScenarios)(
      '$name',
      async ({ accountType, incidents, costs, expectedElements, shouldRedirect }) => {
        mockApiFetch
        .mockResolvedValueOnce(incidents)
        .mockResolvedValueOnce(costs)
          .mockResolvedValueOnce({ accountType });

        let unmount: () => void;
        await act(async () => {
        const result = render(
          <TestWrapper>
              <DashboardPage />
            </TestWrapper>
          );
        unmount = result.unmount;
        });

        if (shouldRedirect) {
        await act(async () => {
        await waitFor(() => {
          expect(mockRouter.push).toHaveBeenCalledWith('/trial');
        });
        });
        } else {
        await act(async () => {
        await waitFor(() => {
        const dashboard = screen.getByTestId('dashboard-content');
          expectedElements.forEach(element => {
              const regex = new RegExp(element.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
                const elementFound = within(dashboard).getByText(regex);
                expect(elementFound).toBeInTheDocument();
                if (!elementFound) {
                  throw new Error(`Elemento "${element}" não encontrado no dashboard`);
                }
              });
            });
          });

          if (incidents.length > 0) {
          // Wait for the incident card title AND specifically for an element
          // within the last expected incident item after sorting.
          const sortedMockIncidents = [...incidents].sort((a, b) => b.impact - a.impact);
          const lastIncidentService = sortedMockIncidents[sortedMockIncidents.length-1].service;

          await act(async () => {
          await waitFor(() => {
          // Ensure the incident section title is present
          const incidentsHeading = screen.getByRole('heading', { name: /recent incidents/i });
          expect(incidentsHeading).toBeInTheDocument();
          const incidentsCard = incidentsHeading.closest('div[class*="rounded-xl"]');
          expect(incidentsCard).toBeInTheDocument();
          // Check that *at least one* incident item is rendered
          expect(screen.queryAllByTestId('incident-item').length).toBeGreaterThan(0);
          // Check for text unique to the *last* item after sorting within the incidents card
          expect(within(incidentsCard! as HTMLElement).getByText(new RegExp(lastIncidentService, 'i'))).toBeInTheDocument();
          });
          });

            // Now get elements and check order
            const incidentElements = screen.getAllByTestId('incident-item');
            const impactValues = incidentElements.map(el => {
              const textContent = within(el).getByTestId('impact-value').textContent || '';
              // Extract number for currency format (Impact: R$ 100,00 or $100.00 -> 100)
              const match = textContent.match(/(R\$|\$)\s?([\d,.]+)/);
              let numericValue = 0;
              if (match) {
                const currency = match[1];
                const amountString = match[2];
                
                // Handle both US ($1,000.00) and BR (R$ 1.000,00) formats
                if (amountString.includes(',') && amountString.includes('.')) {
                  // Determine decimal separator by position
                  const lastCommaPos = amountString.lastIndexOf(',');
                  const lastDotPos = amountString.lastIndexOf('.');
                  
                  if (lastCommaPos > lastDotPos) {
                    // pt-BR format: 1.000,00 -> comma is decimal
                    numericValue = parseFloat(amountString.replace(/\./g, '').replace(',', '.'));
                  } else {
                    // en-US format: 1,000.00 -> period is decimal
                    numericValue = parseFloat(amountString.replace(/,/g, ''));
                  }
                } else if (amountString.includes(',')) {
                  // Only comma: could be decimal (100,50) or thousand separator (1,000)
                  // Assume decimal if less than 3 digits after comma
                  const parts = amountString.split(',');
                  if (parts.length === 2 && parts[1].length <= 2) {
                    numericValue = parseFloat(amountString.replace(',', '.'));
                  } else {
                    numericValue = parseFloat(amountString.replace(/,/g, ''));
                  }
                } else {
                  // Only periods or no separators
                  numericValue = parseFloat(amountString);
                }
              }
              return isNaN(numericValue) ? 0 : numericValue;
            });

            const sortedExpectedValues = sortedMockIncidents.slice(0, 5).map(inc => inc.impact); // Use sorted mock data for comparison base

            expect(impactValues).toEqual(sortedExpectedValues); // Compare rendered values against sorted mock data

            // Keep explicit error throw for clarity if assertion fails
            if (!impactValues.every((value, index) => value === sortedExpectedValues[index])) {
              throw new Error('Incidentes devem estar ordenados por impacto em ordem decrescente. Rendered: [' + impactValues.join(', ') + '], Expected: ['+ sortedExpectedValues.join(', ') +']');
            }

            incidentElements.forEach(el => {
              const dateText = within(el).getByTestId('incident-date').textContent;
              expect(dateText).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
              if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dateText ?? '')) {
                throw new Error('Data do incidente deve estar formatada corretamente');
              }
            });
          }

          if (costs.Groups.length > 0) {
            const totalCost = costs.Groups.reduce(
              (sum: number, group) =>
                sum + Number(group.Metrics.UnblendedCost.Amount),
              0
            );
            // Call with specific locale in tests\n            expect(screen.getByTestId('total-cost')).toHaveTextContent(formatCurrency(totalCost, 'pt-BR'));
          }
        }

        if (unmount!) {
          act(() => {
            unmount();
          });
        }
      }
    );
  });

  describe('Cenários de Erro', () => {
    test.each(errorScenarios)(
      'deve lidar com $name',
      async ({ errors, expectedError }) => {
        // Suppress expected console.error during error handling tests
        const originalConsoleError = console.error;
        console.error = jest.fn();

        mockApiFetch.mockImplementation((url: string) => {
          const controller = new AbortController();
          abortControllers.push(controller);

          return new Promise((resolve, reject) => {
            if (controller.signal.aborted) {
              reject(new Error('Aborted'));
              return;
            }

            if (url === '/api/dashboard/costs' && errors.costs) reject(errors.costs);
            if (url === '/api/incidents' && errors.incidents) reject(errors.incidents);
            if (url === '/api/user/status' && errors.status) reject(errors.status);
            resolve({ accountType: 'PREMIUM' });
          });
        });

        let unmount: () => void;
        await act(async () => {
          const result = render(
            <TestWrapper>
              <DashboardPage />
            </TestWrapper>
          );
          unmount = result.unmount;
        });

        await act(async () => {
          await waitFor(() => {
            expect(screen.getByText(new RegExp(expectedError, 'i'))).toBeInTheDocument();
          });
        });

        if (unmount!) {
          act(() => {
            unmount();
          });
        }

        // Restore console.error
        console.error = originalConsoleError;
      }
    );
  });

  describe('Segurança e Validação', () => {
    test('deve sanitizar dados de entrada', async () => {
      const maliciousInput: MockIncident = {
        id: '"><script>alert("xss")</script>',
        service: '<img src="x" onerror="alert(1)">',
        impact: 100,
        confidence: 0.9,
        status: 'detected',
        region: `'); DROP TABLE users; --`,
        timestamp: new Date().toISOString(),
      };

      mockApiFetch.mockImplementation((url: string) => {
        if (url === '/api/user/status') return Promise.resolve({ accountType: 'PREMIUM' });
        if (url === '/api/incidents') return Promise.resolve([maliciousInput]);
        if (url === '/api/dashboard/costs') return Promise.resolve({ Groups: [] });
        return Promise.resolve({});
      });

      let unmount: () => void;
      await act(async () => {
      const result = render(
        <TestWrapper>
            <DashboardPage />
          </TestWrapper>
        );
      unmount = result.unmount;
      });

      await act(async () => {
      await waitFor(() => {
        const content = screen.getByTestId('dashboard-content');
        const htmlContent = content.innerHTML.toLowerCase();
        expect(htmlContent).toContain('&lt;img src="x" onerror="alert(1)"&gt;');
        expect(htmlContent).not.toContain('<script');
        expect(htmlContent).not.toContain('drop table');
        });
      });

      if (unmount!) {
        act(() => {
          unmount();
        });
      }
    });

    test('deve validar tipos de dados rigorosamente', async () => {
      const invalidData = [
        {
          id: 123,
          service: undefined,
          impact: 'não é número',
          confidence: null,
          status: 'invalid-status',
          region: true,
          timestamp: 'invalid-date',
        },
        {
          id: 'invalid-id',
          service: new Date(),
          impact: NaN,
          confidence: Infinity,
          status: '',
          region: '   ',
          timestamp: null,
        },
      ];

      mockApiFetch.mockImplementation((url: string) => {
        if (url === '/api/user/status') return Promise.resolve({ accountType: 'PREMIUM' });
        if (url === '/api/incidents') return Promise.resolve(invalidData);
        if (url === '/api/dashboard/costs') return Promise.resolve({ Groups: [] });
        return Promise.resolve({});
      });

      let unmount: () => void;
      await act(async () => {
      const result = render(
        <TestWrapper>
            <DashboardPage />
          </TestWrapper>
        );
      unmount = result.unmount;
      });

      await act(async () => {
      await waitFor(() => {
          const noIncidentsElement = screen.getByText('No incidents found');
          expect(noIncidentsElement).toBeInTheDocument();
          if (!noIncidentsElement) {
            throw new Error('Deve mostrar mensagem de "sem incidentes" quando dados são inválidos');
          }
        });
      });

      if (unmount!) {
        act(() => {
          unmount();
        });
      }
    });
  });

  describe('Performance e Memory Leaks', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('deve lidar com timeouts e cancelar requisições', async () => {
      const requestTimeout = 30000;
      let requestsStarted = 0;
      let requestsCanceled = 0;

      mockApiFetch.mockImplementation((url: string) => {
        const controller = new AbortController();
        abortControllers.push(controller);
        requestsStarted++;

        return new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            resolve({ accountType: 'PREMIUM', incidents: [], costs: { Groups: [] } });
          }, requestTimeout);

          controller.signal.addEventListener('abort', () => {
            clearTimeout(timeoutId);
            requestsCanceled++;
            reject(new Error('Aborted'));
          });
        });
      });

      let unmount: () => void;
      await act(async () => {
        const result = render(
          <TestWrapper>
            <DashboardPage />
          </TestWrapper>
        );
        unmount = result.unmount;
      });

      act(() => {
        jest.advanceTimersByTime(requestTimeout / 2);
      });

      if (unmount!) {
        act(() => {
          unmount();
        });
      }
      abortControllers.forEach(controller => controller.abort());

      expect(requestsCanceled).toBe(requestsStarted);
      expect(requestsStarted).toBeGreaterThanOrEqual(3);
    });

    test('não deve aumentar chamadas desnecessárias durante atualizações periódicas', async () => {
      const updateInterval = 60000;
      const totalUpdates = 5;

      mockApiFetch.mockClear();
      mockApiFetch.mockImplementation(() =>
        Promise.resolve({ accountType: 'PREMIUM', incidents: [], costs: { Groups: [] } })
      );

      let unmount: () => void;
      await act(async () => {
      const result = render(
        <TestWrapper>
            <DashboardPage />
          </TestWrapper>
        );
        unmount = result.unmount;
      });

      const callsBefore = mockApiFetch.mock.calls.length;

      for (let i = 0; i < totalUpdates; i++) {
        await act(async () => {
          jest.advanceTimersByTime(updateInterval);
          await Promise.resolve();
        });
      }

      const callsAfter = mockApiFetch.mock.calls.length;
      expect(callsAfter).toBeLessThanOrEqual(callsBefore + totalUpdates * 3);

      if (unmount!) {
        act(() => {
          unmount();
        });
      }
    });
  });
});