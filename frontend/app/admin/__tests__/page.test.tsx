import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminPage from '../page';
import { apiFetch } from '@/lib/api';

// Mock the apiFetch function
jest.mock('@/lib/api', () => ({
  apiFetch: jest.fn(),
}));

// Mock the AdminRoute component
jest.mock('@/components/auth/AdminRoute', () => ({
  AdminRoute: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Mock toast
jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

describe('AdminPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads and displays admin metrics', async () => {
    const mockMetrics = {
      customers: {
        total: 150,
        trial: 45,
        active: 105,
        churnedThisMonth: 3,
      },
      revenue: {
        thisMonth: 2500.00,
        lastMonth: 2200.00,
        growth: 13.6,
      },
      leads: {
        newThisWeek: 12,
        conversionRate: 68.5,
        highValueCount: 8,
      },
      recommendations: {
        totalGenerated: 1250,
        executed: 890,
        executionRate: 71.2,
      },
      sla: {
        claimsDetected: 45,
        claimsSubmitted: 38,
        creditsRecovered: 1250.00,
      },
    };

    const mockSettings = {
      settings: {
        commissionRate: 0.30,
        updatedAt: new Date().toISOString(),
      },
      coupons: [],
      promotions: [],
    };

    mockApiFetch
      .mockResolvedValueOnce(mockMetrics) // metrics call
      .mockResolvedValueOnce(mockSettings); // settings call

    render(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByText('150')).toBeInTheDocument(); // total customers
      expect(screen.getByText('$2,500.00')).toBeInTheDocument(); // revenue
      expect(screen.getByText('68.5%')).toBeInTheDocument(); // conversion rate
    });

    expect(mockApiFetch).toHaveBeenCalledWith('/admin/metrics');
    expect(mockApiFetch).toHaveBeenCalledWith('/admin/settings');
  });

  it('updates commission rate successfully', async () => {
    const mockSettings = {
      settings: { commissionRate: 0.30 },
      coupons: [],
      promotions: [],
    };

    mockApiFetch.mockResolvedValue(mockSettings);

    render(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('30')).toBeInTheDocument();
    });

    const input = screen.getByDisplayValue('30');
    const updateButton = screen.getByText('Atualizar');

    fireEvent.change(input, { target: { value: '35' } });
    fireEvent.click(updateButton);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ commissionRate: 0.35 }),
      });
    });
  });

  it('handles API errors gracefully', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('API Error'));

    render(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByText('Erro ao carregar métricas admin')).toBeInTheDocument();
    });
  });

  it('creates a coupon successfully', async () => {
    const mockSettings = {
      settings: { commissionRate: 0.30 },
      coupons: [],
      promotions: [],
    };

    mockApiFetch
      .mockResolvedValueOnce({}) // initial metrics
      .mockResolvedValueOnce(mockSettings) // initial settings
      .mockResolvedValueOnce({}) // create coupon
      .mockResolvedValueOnce(mockSettings); // reload settings

    render(<AdminPage />);

    await waitFor(() => {
      expect(screen.getByText('Código do cupom')).toBeInTheDocument();
    });

    const codeInput = screen.getByPlaceholderText('Código do cupom');
    const valueInput = screen.getByPlaceholderText('Valor');
    const createButton = screen.getByText('Criar Cupom');

    fireEvent.change(codeInput, { target: { value: 'TEST10' } });
    fireEvent.change(valueInput, { target: { value: '10' } });
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/admin/coupons', {
        method: 'POST',
        body: JSON.stringify({
          code: 'TEST10',
          discountType: 'percentage',
          discountValue: 10,
          validUntil: '',
          maxUses: '',
          description: '',
        }),
      });
    });
  });
});
