// frontend/app/billing/__tests__/page.test.tsx

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { ToasterProvider } from '@/components/ui/toaster';
import BillingPage from '../page';

// Mock AuthProvider
jest.mock('@/components/auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useAuth: () => ({
    user: { username: 'test-user', email: 'test@example.com' },
    loading: false,
    signOut: jest.fn()
  }),
}));

// Mock useNotify hook
jest.mock('@/hooks/useNotify', () => ({
  useNotify: () => ({
    info: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
  }),
}));

// Mock next/navigation
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  refresh: jest.fn(),
  back: jest.fn(),
  forward: jest.fn(),
  prefetch: jest.fn(),
};

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/billing',
}));

// Mock apiClient
jest.mock('@/lib/api', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockApiClient = (jest.requireMock('@/lib/api') as any).apiClient;

// Mock PageHeader
jest.mock('@/components/layout/PageHeader', () => ({
  PageHeader: ({ title, description }: { title: string; description: string }) => (
    <div data-testid="page-header">
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  ),
}));

// Mock Card components
jest.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div data-testid="card">{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div data-testid="card-header">{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <div data-testid="card-title">{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div data-testid="card-content">{children}</div>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <div data-testid="card-description">{children}</div>,
}));

// Mock Table components
jest.mock('@/components/ui/table', () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table data-testid="table">{children}</table>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody data-testid="table-body">{children}</tbody>,
  TableCell: ({ children }: { children: React.ReactNode }) => <td data-testid="table-cell">{children}</td>,
  TableHead: ({ children }: { children: React.ReactNode }) => <th data-testid="table-head">{children}</th>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead data-testid="table-header">{children}</thead>,
  TableRow: ({ children }: { children: React.ReactNode }) => <tr data-testid="table-row">{children}</tr>,
}));

// Mock Badge
jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children, variant }: { children: React.ReactNode; variant?: string }) => (
    <span data-testid={`badge-${variant || 'default'}`}>{children}</span>
  ),
}));

// Mock AnimatedCounter
jest.mock('@/components/ui/AnimatedCounter', () => ({
  AnimatedCounter: ({ value, prefix, decimals }: { value: number; prefix?: string; decimals?: number }) => (
    <span data-testid="animated-counter">{prefix || ''}{value.toFixed(decimals || 2)}</span>
  ),
}));

// Test wrapper component
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AuthProvider>
    <ToasterProvider>{children}</ToasterProvider>
  </AuthProvider>
);

describe('BillingPage', () => {
  const mockSummary = {
  totalValue: 1500.50,
  yourSavings: 1050.35,
  ourCommission: 450.15,
  recommendations: { executed: 12 },
  sla: { totalCredits: 300.00 },
  };

  const mockHistory = {
    history: [
      {
        type: 'saving',
        amount: 500.00,
        timestamp: '2024-01-15T10:30:00Z',
      },
      {
        type: 'credit',
        amount: 200.00,
        timestamp: '2024-01-20T14:45:00Z',
      },
      {
        type: 'saving',
        amount: 300.00,
        timestamp: '2024-02-01T09:15:00Z',
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockApiClient.get.mockClear();
  });

  describe('Loading State', () => {
    test('shows loading skeletons while fetching data', async () => {
      // Mock pending promises
      mockApiClient.get.mockImplementation(() => new Promise(() => {}));

      render(
        <TestWrapper>
          <BillingPage />
        </TestWrapper>
      );

      // Should show loading skeletons
      expect(screen.getByTestId('page-header')).toBeInTheDocument();
      expect(screen.getAllByTestId('card')).toHaveLength(4); // 4 stat cards

      // Should not show actual data yet
      expect(screen.queryByText('R$')).not.toBeInTheDocument();
    });
  });

  describe('Successful Data Load', () => {
    beforeEach(() => {
      mockApiClient.get
        .mockResolvedValueOnce(mockSummary)
        .mockResolvedValueOnce(mockHistory);
    });

    test('renders billing summary correctly', async () => {
      render(
        <TestWrapper>
          <BillingPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Faturamento e Economias')).toBeInTheDocument();
      });

      // Check stat cards
      expect(screen.getByText('Total Economizado no Período')).toBeInTheDocument();
      expect(screen.getByText('Sua Economia Líquida (70%)')).toBeInTheDocument();
      expect(screen.getByText('Nossa Comissão (30%)')).toBeInTheDocument();
      expect(screen.getByText('Recomendações Executadas')).toBeInTheDocument();

      // Check values are displayed
      expect(screen.getAllByTestId('animated-counter')).toHaveLength(4);
      expect(screen.getByText('12')).toBeInTheDocument(); // recommendations executed
    });

    test('renders billing history table correctly', async () => {
      render(
        <TestWrapper>
          <BillingPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('table')).toBeInTheDocument();
      });

      // Check table headers
      expect(screen.getByText('Mês')).toBeInTheDocument();
      expect(screen.getByText('Economia (Recomendações)')).toBeInTheDocument();
      expect(screen.getByText('Economia (Créditos SLA)')).toBeInTheDocument();
      expect(screen.getByText('Total Economizado')).toBeInTheDocument();
      expect(screen.getByText('Fatura (30%)')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();

      // Check table data
      expect(screen.getAllByTestId('table-row')).toHaveLength(4); // 3 data rows + 1 empty state check

      // Check formatted dates
      expect(screen.getByText(/janeiro de 2024/i)).toBeInTheDocument();
      expect(screen.getByText(/fevereiro de 2024/i)).toBeInTheDocument();

      // Check currency formatting
      expect(screen.getAllByText(/R\$/)).toHaveLength(6); // 3 total + 3 commission values
    });

    test('handles empty history gracefully', async () => {
      mockApiClient.get
        .mockResolvedValueOnce(mockSummary)
        .mockResolvedValueOnce({ history: [] });

      render(
        <TestWrapper>
          <BillingPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Nenhum histórico de faturamento encontrado.')).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    test('shows error message when API fails', async () => {
      const errorMessage = 'Failed to load billing data';
      mockApiClient.get.mockRejectedValueOnce(new Error(errorMessage));

      render(
        <TestWrapper>
          <BillingPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Faturamento e Economias')).toBeInTheDocument();
        expect(screen.getByText('Nenhum dado de faturamento encontrado.')).toBeInTheDocument();
      });

      // Error should be logged but not crash the component
      expect(mockApiClient.get).toHaveBeenCalledTimes(1);
    });

    test('handles partial API failures gracefully', async () => {
      mockApiClient.get
        .mockResolvedValueOnce(mockSummary)
        .mockRejectedValueOnce(new Error('History API failed'));

      render(
        <TestWrapper>
          <BillingPage />
        </TestWrapper>
      );

      await waitFor(() => {
        // Should still show summary data
        expect(screen.getByText('Total Economizado no Período')).toBeInTheDocument();
        // History should show empty state
        expect(screen.getByText('Nenhum histórico de faturamento encontrado.')).toBeInTheDocument();
      });
    });
  });

  describe('Data Validation and Formatting', () => {
    test('handles invalid amount values safely', async () => {
      const invalidHistory = {
        history: [
          {
            type: 'saving',
            amount: null, // Invalid amount
            timestamp: '2024-01-15T10:30:00Z',
          },
          {
            type: 'credit',
            amount: 'invalid', // Invalid amount
            timestamp: null, // Invalid timestamp
          },
        ],
      };

      mockApiClient.get
        .mockResolvedValueOnce(mockSummary)
        .mockResolvedValueOnce(invalidHistory);

      render(
        <TestWrapper>
          <BillingPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('table')).toBeInTheDocument();
      });

      // Should show fallback values without crashing
      expect(screen.getByText('Data indisponível')).toBeInTheDocument();
      expect(screen.getAllByText('R$ 0.00')).toHaveLength(2); // Fallback for invalid amounts
    });

    test('handles invalid timestamps gracefully', async () => {
      const invalidHistory = {
        history: [
          {
            type: 'saving',
            amount: 100,
            timestamp: 'invalid-date',
          },
        ],
      };

      mockApiClient.get
        .mockResolvedValueOnce(mockSummary)
        .mockResolvedValueOnce(invalidHistory);

      render(
        <TestWrapper>
          <BillingPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Data indisponível')).toBeInTheDocument();
      });
    });

    test('handles unknown history types', async () => {
      const unknownTypeHistory = {
        history: [
          {
            type: 'unknown',
            amount: 100,
            timestamp: '2024-01-15T10:30:00Z',
          },
        ],
      };

      mockApiClient.get
        .mockResolvedValueOnce(mockSummary)
        .mockResolvedValueOnce(unknownTypeHistory);

      render(
        <TestWrapper>
          <BillingPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByTestId('table')).toBeInTheDocument();
      });

      // Should show '-' for unknown types
      expect(screen.getAllByText('-')).toHaveLength(2); // saving and credit columns
    });
  });

  describe('Performance and Memory', () => {
    test('cancels requests on unmount', async () => {
      let resolvePromise: (value: any) => void;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      mockApiClient.get.mockReturnValue(pendingPromise);

      const { unmount } = render(
        <TestWrapper>
          <BillingPage />
        </TestWrapper>
      );

      // Unmount before promise resolves
      unmount();

      // Resolve promise after unmount
      act(() => {
        resolvePromise!(mockSummary);
      });

      // Should not cause state updates or errors
      expect(mockApiClient.get).toHaveBeenCalledTimes(2);
    });

    test('handles rapid re-renders without excessive API calls', async () => {
      mockApiClient.get
        .mockResolvedValueOnce(mockSummary)
        .mockResolvedValueOnce(mockHistory);

      const { rerender } = render(
        <TestWrapper>
          <BillingPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Faturamento e Economias')).toBeInTheDocument();
      });

      // Re-render should not trigger additional API calls
      rerender(
        <TestWrapper>
          <BillingPage />
        </TestWrapper>
      );

      expect(mockApiClient.get).toHaveBeenCalledTimes(2); // Only initial calls
    });
  });

  describe('Accessibility', () => {
    test('has proper semantic structure', async () => {
      mockApiClient.get
        .mockResolvedValueOnce(mockSummary)
        .mockResolvedValueOnce(mockHistory);

      render(
        <TestWrapper>
          <BillingPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Faturamento e Economias' })).toBeInTheDocument();
      });

      // Check table has proper structure
      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getAllByRole('row')).toHaveLength(4); // Header + 3 data rows
    });
  });

  describe('API Integration', () => {
    test('calls correct API endpoints', async () => {
      mockApiClient.get
        .mockResolvedValueOnce(mockSummary)
        .mockResolvedValueOnce(mockHistory);

      render(
        <TestWrapper>
          <BillingPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(mockApiClient.get).toHaveBeenCalledWith('/billing/summary');
        expect(mockApiClient.get).toHaveBeenCalledWith('/billing/history');
      });
    });

    test('handles API response structure variations', async () => {
      const minimalSummary = {
      totalValue: 100,
      yourSavings: 70,
      ourCommission: 30,
      recommendations: { executed: 1 },
      sla: { totalCredits: 0 },
      };

      const emptyHistory = { history: null };

      mockApiClient.get
        .mockResolvedValueOnce(minimalSummary)
        .mockResolvedValueOnce(emptyHistory);

      render(
        <TestWrapper>
          <BillingPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Nenhum histórico de faturamento encontrado.')).toBeInTheDocument();
      });
    });
  });
});
