import React from 'react'
import { render, screen } from '@testing-library/react'
import Home from '../page'

// Mock next/link
jest.mock('next/link', () => {
  return ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href} data-testid={`link-${href}`}>
      {children}
    </a>
  )
})

// Mock react-i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key, // Return key as is for testing
  }),
}))

describe('Home Page', () => {
  it('renders welcome message', () => {
    render(<Home />)

    expect(screen.getByText('welcome')).toBeInTheDocument()
  })

  it('renders onboarding button', () => {
    render(<Home />)

    const onboardingLink = screen.getByTestId('link-/onboard')
    expect(onboardingLink).toBeInTheDocument()
    expect(screen.getByText('onboarding')).toBeInTheDocument()
  })

  it('renders dashboard button', () => {
    render(<Home />)

    const dashboardLink = screen.getByTestId('link-/dashboard')
    expect(dashboardLink).toBeInTheDocument()
    expect(screen.getByText('dashboard')).toBeInTheDocument()
  })

  it('has correct structure', () => {
    render(<Home />)

    const main = screen.getByRole('main')
    expect(main).toHaveClass('flex', 'min-h-screen', 'flex-col', 'items-center', 'justify-center', 'p-24')

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent('welcome')
  })
})
