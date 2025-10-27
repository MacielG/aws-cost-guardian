import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import DashboardPage from '../page';

const mockFetch = global.fetch as jest.Mock;

jest.mock('@/components/charts/BarChart', () => () => <div data-testid="bar-chart-mock" />);
jest.mock('@/components/charts/LineChart', () => () => <div data-testid="line-chart-mock" />);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('DashboardPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('deve exibir dados iniciais corretamente', async () => {
    const mockIncidents = [
      { id: '1', service: 'EC2', impact: 100, confidence: 0.9, status: 'refunded' },
    ];

    const mockCosts = [
      { service: 'EC2', cost: 500 },
    ];

    mockFetch
      .mockImplementationOnce(() =>
        Promise.resolve({
          json: () => Promise.resolve(mockIncidents),
        })
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          json: () => Promise.resolve(mockCosts),
          ok: true,
        })
      );

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('dashboard')).toBeInTheDocument();
      expect(screen.getByText('earnings')).toBeInTheDocument();
    });
  });

  test('deve lidar com erro na API de custos', async () => {
    mockFetch
      .mockImplementationOnce(() =>
        Promise.resolve({
          json: () => Promise.resolve([]),
        })
      )
      .mockImplementationOnce(() =>
        Promise.reject(new Error('API Error'))
      );

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('dashboard')).toBeInTheDocument();
    });
  });
});
