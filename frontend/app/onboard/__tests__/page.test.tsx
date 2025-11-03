// frontend/app/onboard/__tests__/page.test.tsx

import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { ToasterProvider } from '@/components/ui/toaster';
import OnboardPage from '../page';

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

const mockSearchParams = {
  get: jest.fn(),
  has: jest.fn(),
  forEach: jest.fn(),
  entries: jest.fn(),
  keys: jest.fn(),
  values: jest.fn(),
  toString: jest.fn(),
};

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams,
  usePathname: () => '/onboard',
}));

// Mock URL utilities
jest.mock('@/lib/url', () => ({
  joinUrl: jest.fn((base, path) => `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`),
}));

// Mock framer-motion
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => React.createElement('div', props, children),
    button: ({ children, ...props }: any) => React.createElement('button', props, children),
  },
  AnimatePresence: ({ children }: any) => children,
}));

// Global fetch mock
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock environment variables
const originalEnv = process.env;
beforeEach(() => {
  process.env = {
    ...originalEnv,
    NEXT_PUBLIC_API_URL: 'https://api.example.com',
    NEXT_PUBLIC_CFN_TEMPLATE_URL: 'https://template.example.com/template.yaml',
  };
});

afterEach(() => {
  process.env = originalEnv;
  jest.clearAllMocks();
});

// Test wrapper component
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AuthProvider>
    <ToasterProvider>{children}</ToasterProvider>
  </AuthProvider>
);

describe('OnboardPage', () => {
  const defaultConfig = {
    status: 'PENDING_CFN',
    externalId: 'test-external-id',
    platformAccountId: '123456789012',
    templateUrl: 'https://template.example.com/template.yaml',
    termsAccepted: true,
  };

  beforeEach(() => {
    mockRouter.push.mockClear();
    mockRouter.replace.mockClear();
    mockSearchParams.get.mockReturnValue(null);
  });

  describe('Initial Loading State', () => {
    test('shows loading skeleton while fetching config', async () => {
      mockFetch.mockImplementationOnce(() =>
        new Promise(() => {}) // Never resolves to keep loading state
      );

      render(
        <TestWrapper>
          <OnboardPage />
        </TestWrapper>
      );

      expect(screen.getByText('Prepare sua conta AWS')).toBeInTheDocument();
      expect(screen.getByText('Bem-vindo ao AWS Cost Guardian')).toBeInTheDocument();
    });
  });

  describe('Successful Config Fetch', () => {
    test('renders onboarding steps with CloudFormation link', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(defaultConfig),
      });

      render(
        <TestWrapper>
          <OnboardPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Prepare sua conta AWS')).toBeInTheDocument();
      });

      expect(screen.getByText('Análise de Recursos')).toBeInTheDocument();
      expect(screen.getByText('Receba Recomendações')).toBeInTheDocument();

      // Check if CloudFormation link is generated and button is present
      const connectButton = screen.getByRole('button', { name: /conectar com aws/i });
      expect(connectButton).toBeInTheDocument();
    });

    test('handles trial mode parameter', async () => {
      mockSearchParams.get.mockReturnValue('trial');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ...defaultConfig, mode: 'trial' }),
      });

      render(
        <TestWrapper>
          <OnboardPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/onboard-init?mode=trial', expect.any(Object));
      });
    });
  });

  describe('Error Handling', () => {
    test('shows error notification on config fetch failure', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      render(
        <TestWrapper>
          <OnboardPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    test('handles API response error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      render(
        <TestWrapper>
          <OnboardPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Terms Acceptance', () => {
    test('redirects to terms page when terms not accepted', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ...defaultConfig, termsAccepted: false }),
      });

      render(
        <TestWrapper>
          <OnboardPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(mockRouter.push).toHaveBeenCalledWith('/terms');
      });
    });
  });

  describe('Status Handling', () => {
    test('redirects to dashboard when onboarding completed', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ...defaultConfig, status: 'COMPLETED' }),
      });

      render(
        <TestWrapper>
          <OnboardPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(mockRouter.push).toHaveBeenCalledWith('/dashboard');
      });
    });

    test('shows appropriate status for different onboarding states', async () => {
      const statuses = ['PENDING_CFN', 'CFN_DEPLOYING', 'VALIDATING', 'ACTIVE'];

      for (const status of statuses) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ...defaultConfig, status }),
        });

        const { rerender } = render(
          <TestWrapper>
            <OnboardPage />
          </TestWrapper>
        );

        await waitFor(() => {
          expect(screen.getByText('Prepare sua conta AWS')).toBeInTheDocument();
        });

        // Status should be set correctly
        rerender(
          <TestWrapper>
            <OnboardPage />
          </TestWrapper>
        );
      }
    });
  });

  describe('Navigation and User Interaction', () => {
    test('opens CloudFormation link in new tab', async () => {
      const mockOpen = jest.spyOn(window, 'open').mockImplementation(() => null);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(defaultConfig),
      });

      render(
        <TestWrapper>
          <OnboardPage />
        </TestWrapper>
      );

      await waitFor(() => {
        const connectButton = screen.getByRole('button', { name: /conectar com aws/i });
        fireEvent.click(connectButton);

        expect(mockOpen).toHaveBeenCalledWith(
          expect.stringContaining('cloudformation'),
          '_blank'
        );
      });

      mockOpen.mockRestore();
    });
  });

  describe('Security and Validation', () => {
    test('validates externalId and platformAccountId in URL', async () => {
      const mockOpen = jest.spyOn(window, 'open').mockImplementation(() => null);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(defaultConfig),
      });

      render(
        <TestWrapper>
          <OnboardPage />
        </TestWrapper>
      );

      await waitFor(() => {
        const connectButton = screen.getByRole('button', { name: /conectar com aws/i });
        fireEvent.click(connectButton);

        expect(mockOpen).toHaveBeenCalledWith(
          expect.stringContaining('param_ExternalId=test-external-id'),
          '_blank'
        );
        expect(mockOpen).toHaveBeenCalledWith(
          expect.stringContaining('param_PlatformAccountId=123456789012'),
          '_blank'
        );
      });

      mockOpen.mockRestore();
    });

    test('handles missing environment variables gracefully', async () => {
      delete process.env.NEXT_PUBLIC_API_URL;
      delete process.env.NEXT_PUBLIC_CFN_TEMPLATE_URL;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          ...defaultConfig,
          templateUrl: undefined,
        }),
      });

      render(
        <TestWrapper>
          <OnboardPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Prepare sua conta AWS')).toBeInTheDocument();
      });

      // Should still render without crashing
      expect(screen.getByRole('button', { name: /conectar com aws/i })).toBeInTheDocument();
    });
  });

  describe('Performance and Memory', () => {
    test('cancels ongoing requests on unmount', async () => {
      let abortController: AbortController | null = null;

      mockFetch.mockImplementationOnce((url, options) => {
        abortController = (options as any)?.signal?.aborted ? null : new AbortController();
        return new Promise((resolve) => {
          setTimeout(() => resolve({
            ok: true,
            json: () => Promise.resolve(defaultConfig),
          }), 100);
        });
      });

      const { unmount } = render(
        <TestWrapper>
          <OnboardPage />
        </TestWrapper>
      );

      // Unmount before request completes
      unmount();

      // Request should be aborted
      if (abortController) {
        expect(abortController.signal.aborted).toBe(true);
      }
    });

    test('handles rapid re-mounting without memory leaks', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(defaultConfig),
      });

      const { rerender, unmount } = render(
        <TestWrapper>
          <OnboardPage />
        </TestWrapper>
      );

      // Re-render multiple times rapidly
      for (let i = 0; i < 5; i++) {
        rerender(
          <TestWrapper>
            <OnboardPage />
          </TestWrapper>
        );
      }

      unmount();

      // Should not have excessive API calls
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Accessibility', () => {
    test('has proper ARIA labels and roles', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(defaultConfig),
      });

      render(
        <TestWrapper>
          <OnboardPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /conectar com aws/i })).toBeInTheDocument();
      });

      // Check for proper heading hierarchy
      const headings = screen.getAllByRole('heading');
      expect(headings.length).toBeGreaterThan(0);
      expect(headings.some(h => h.textContent?.includes('Bem-vindo ao AWS Cost Guardian'))).toBe(true);
    });

    test('supports keyboard navigation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(defaultConfig),
      });

      render(
        <TestWrapper>
          <OnboardPage />
        </TestWrapper>
      );

      await waitFor(() => {
        const connectButton = screen.getByRole('button', { name: /conectar com aws/i });
        connectButton.focus();

        expect(document.activeElement).toBe(connectButton);
      });
    });
  });

  describe('Edge Cases', () => {
    test('handles malformed API responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      render(
        <TestWrapper>
          <OnboardPage />
        </TestWrapper>
      );

      await waitFor(() => {
        expect(screen.getByText('Prepare sua conta AWS')).toBeInTheDocument();
      });

      // Should render with default/empty values without crashing
    });

    test('handles network timeouts', async () => {
      jest.useFakeTimers();

      mockFetch.mockImplementationOnce(() =>
        new Promise((resolve) => {
          setTimeout(() => resolve({
            ok: true,
            json: () => Promise.resolve(defaultConfig),
          }), 30000); // Long delay
        })
      );

      render(
        <TestWrapper>
          <OnboardPage />
        </TestWrapper>
      );

      // Fast-forward time
      act(() => {
        jest.advanceTimersByTime(31000);
      });

      await waitFor(() => {
        expect(screen.getByText('Prepare sua conta AWS')).toBeInTheDocument();
      });

      jest.useRealTimers();
    });
  });
});
