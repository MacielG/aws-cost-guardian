import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import DashboardPage from '../page';
import { AuthProvider } from '@/components/auth/AuthProvider';

const mockFetch = global.fetch as jest.Mock;

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

jest.mock('@/components/charts/BarChart', () => () => <div data-testid="bar-chart-mock" />);
jest.mock('@/components/charts/LineChart', () => () => <div data-testid="line-chart-mock" />);

jest.mock('@/lib/api', () => ({
  apiFetch: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: { [key: string]: string } = {
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
      };
      return translations[key] || key;
    }
  }),
}));

// Mock useAuth hook
jest.mock('@/components/auth/AuthProvider', () => ({
  ...jest.requireActual('@/components/auth/AuthProvider'),
  useAuth: () => ({
    user: { id: 'test-user', email: 'test@example.com' },
    loading: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
  }),
}));

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AuthProvider>
    {children}
  </AuthProvider>
);

describe('DashboardPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('deve exibir dados iniciais corretamente', async () => {
    const mockIncidents = [
      { id: '1', service: 'EC2', impact: 100, confidence: 0.9, status: 'refunded' },
    ];

    const mockCosts = [
      {
        Groups: [
          {
            Keys: ['EC2'],
            Metrics: { UnblendedCost: { Amount: '500' } }
          }
        ]
      }
    ];

    const mockApiFetch = require('@/lib/api').apiFetch;
    mockApiFetch
      .mockImplementationOnce(() => Promise.resolve(mockIncidents))
      .mockImplementationOnce(() => Promise.resolve({ accountType: 'PREMIUM' }))
      .mockImplementationOnce(() => Promise.resolve(mockCosts));

    render(
      <TestWrapper>
        <DashboardPage />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Total Earnings')).toBeInTheDocument();
      expect(screen.getByText('$70.00')).toBeInTheDocument(); // 100 * 0.7
      expect(screen.getByText('$500.00')).toBeInTheDocument(); // total cost
    });
  });

  test('deve lidar com erro na API de custos', async () => {
    const mockApiFetch = require('@/lib/api').apiFetch;
    mockApiFetch
      .mockImplementationOnce(() => Promise.resolve([]))
      .mockImplementationOnce(() => Promise.resolve({ accountType: 'PREMIUM' }))
      .mockImplementationOnce(() => Promise.reject(new Error('API Error')));

    render(
      <TestWrapper>
        <DashboardPage />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('No cost data available')).toBeInTheDocument();
    });
  });

  test('deve redirecionar usuários trial', async () => {
    const mockRouter = { push: jest.fn() };
    require('next/navigation').useRouter.mockReturnValue(mockRouter);

    const mockApiFetch = require('@/lib/api').apiFetch;
    mockApiFetch
      .mockImplementationOnce(() => Promise.resolve([]))
      .mockImplementationOnce(() => Promise.resolve({ accountType: 'TRIAL' }));

    render(
      <TestWrapper>
        <DashboardPage />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith('/trial');
    });
  });

  test('deve exibir incidentes corretamente', async () => {
    const mockIncidents = [
      { id: '1', service: 'EC2', impact: 100, confidence: 0.9, status: 'refunded' },
      { id: '2', service: 'RDS', impact: 50, confidence: 0.8, status: 'detected' },
    ];

    const mockApiFetch = require('@/lib/api').apiFetch;
    mockApiFetch
      .mockImplementationOnce(() => Promise.resolve(mockIncidents))
      .mockImplementationOnce(() => Promise.resolve({ accountType: 'PREMIUM' }))
      .mockImplementationOnce(() => Promise.resolve([]));

    render(
      <TestWrapper>
        <DashboardPage />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Recent Incidents')).toBeInTheDocument();
      expect(screen.getByText('EC2')).toBeInTheDocument();
      expect(screen.getByText('RDS')).toBeInTheDocument();
      expect(screen.getByText('Impact: $100')).toBeInTheDocument();
      expect(screen.getByText('Refunded')).toBeInTheDocument();
      expect(screen.getByText('Detected')).toBeInTheDocument();
    });
  });

  test('deve calcular estatísticas corretamente', async () => {
    const mockIncidents = [
      { id: '1', service: 'EC2', impact: 100, confidence: 0.9, status: 'refunded' },
      { id: '2', service: 'RDS', impact: 50, confidence: 0.8, status: 'submitted' },
      { id: '3', service: 'Lambda', impact: 25, confidence: 0.7, status: 'detected' },
    ];

    const mockCosts = [
      {
        Groups: [
          { Keys: ['EC2'], Metrics: { UnblendedCost: { Amount: '200' } } },
          { Keys: ['RDS'], Metrics: { UnblendedCost: { Amount: '150' } } }
        ]
      }
    ];

    const mockApiFetch = require('@/lib/api').apiFetch;
    mockApiFetch
      .mockImplementationOnce(() => Promise.resolve(mockIncidents))
      .mockImplementationOnce(() => Promise.resolve({ accountType: 'PREMIUM' }))
      .mockImplementationOnce(() => Promise.resolve(mockCosts));

    render(
      <TestWrapper>
        <DashboardPage />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('$70.00')).toBeInTheDocument(); // Only refunded: 100 * 0.7
      expect(screen.getByText('$350.00')).toBeInTheDocument(); // 200 + 150
      expect(screen.getByText('2')).toBeInTheDocument(); // Active incidents: submitted + detected
      expect(screen.getByText('1 detected')).toBeInTheDocument();
    });
  });

  test('deve renderizar sem erros', () => {
    const mockApiFetch = require('@/lib/api').apiFetch;
    mockApiFetch
      .mockImplementationOnce(() => Promise.resolve([]))
      .mockImplementationOnce(() => Promise.resolve({ accountType: 'PREMIUM' }))
      .mockImplementationOnce(() => Promise.resolve([]));

    expect(() =>
      render(
        <TestWrapper>
          <DashboardPage />
        </TestWrapper>
      )
    ).not.toThrow();
  });

  test('deve lidar com dados vazios', async () => {
    const mockApiFetch = require('@/lib/api').apiFetch;
    mockApiFetch
      .mockImplementationOnce(() => Promise.resolve([]))
      .mockImplementationOnce(() => Promise.resolve({ accountType: 'PREMIUM' }))
      .mockImplementationOnce(() => Promise.resolve([]));

    render(
      <TestWrapper>
        <DashboardPage />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('No incidents found')).toBeInTheDocument();
      expect(screen.getByText('No cost data available')).toBeInTheDocument();
      expect(screen.getByText('$0.00')).toBeInTheDocument();
    });
  });
});
