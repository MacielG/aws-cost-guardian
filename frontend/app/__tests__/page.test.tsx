import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  it('renders main title and description', () => {
    render(<Home />)

    expect(screen.getByText('AWS Cost Guardian')).toBeInTheDocument()
    expect(screen.getByText('Economize automaticamente na sua conta AWS. Detectamos recursos ociosos, recuperamos créditos SLA e otimizamos seus custos de nuvem.')).toBeInTheDocument()
  })

  it('renders trial analysis buttons', () => {
    render(<Home />)

    const trialLinks = screen.getAllByTestId('link-/login?mode=trial')
    expect(trialLinks).toHaveLength(2) // Two buttons on the page
    expect(screen.getAllByText('Iniciar Análise Gratuita →')).toHaveLength(2)
  })

  it('renders benefits section with correct content', () => {
    render(<Home />)

    expect(screen.getByText('Por que escolher o AWS Cost Guardian?')).toBeInTheDocument()
    expect(screen.getByText('Economia Garantida')).toBeInTheDocument()
    expect(screen.getByText('Créditos SLA Automáticos')).toBeInTheDocument()
    expect(screen.getByText('Sem Esforço')).toBeInTheDocument()
  })

  it('renders commission model section', () => {
    render(<Home />)

    expect(screen.getByText('Como Funciona Nosso Modelo')).toBeInTheDocument()
    expect(screen.getByText('30% da Economia Recuperada')).toBeInTheDocument()
    // text may be split across elements; match by substring
    expect(screen.getByText((content) => content.includes('retemos apenas 30 centavos'))).toBeInTheDocument()
  })

  it('renders features section', () => {
    render(<Home />)

    expect(screen.getByText('Recursos Principais')).toBeInTheDocument()
    expect(screen.getByText('Monitoramento em Tempo Real')).toBeInTheDocument()
    expect(screen.getByText('Execução Segura')).toBeInTheDocument()
    expect(screen.getByText('Otimização Contínua')).toBeInTheDocument()
    expect(screen.getByText('Relatórios Detalhados')).toBeInTheDocument()
  })

  it('renders final CTA section', () => {
    render(<Home />)

    expect(screen.getByText('Pronto para começar a economizar?')).toBeInTheDocument()
    expect(screen.getByText('Cadastre-se gratuitamente e veja quanto você pode economizar na sua conta AWS.')).toBeInTheDocument()
  })

  it('has correct main structure', () => {
    render(<Home />)

    const main = screen.getByRole('main')
    expect(main).toHaveClass('min-h-screen', 'bg-gradient-to-br', 'from-blue-50', 'to-indigo-100')

    const headings = screen.getAllByRole('heading')
    expect(headings.length).toBeGreaterThanOrEqual(8) // Multiple h1, h2, h3
  })

  it('buttons are accessible and clickable', async () => {
    const user = userEvent.setup()
    render(<Home />)

    const buttons = screen.getAllByRole('button', { name: /Iniciar Análise Gratuita/ })
    expect(buttons).toHaveLength(2)

    // Test that buttons have proper accessibility
    buttons.forEach(button => {
      // type attribute might be omitted in markup; ensure it's a button element and enabled
      expect(button.tagName).toBe('BUTTON')
      expect(button).not.toBeDisabled()
    })

    // Test click simulation (though link is mocked)
    await user.click(buttons[0])
    // In real scenario, this would navigate, but with mock we just ensure no errors
  })

  it('icons are rendered correctly', () => {
    render(<Home />)

    // Check for presence of icons via their classes (lucide icons)
    const icons = document.querySelectorAll('[class*="lucide"]')
    expect(icons.length).toBeGreaterThan(0)
  })

  it('responsive grid layout is applied', () => {
    render(<Home />)

    const grids = document.querySelectorAll('[class*="grid"]')
    expect(grids.length).toBeGreaterThan(0)

    // Check for responsive classes
    const responsiveElements = document.querySelectorAll('[class*="md:"]')
    expect(responsiveElements.length).toBeGreaterThan(0)
  })

  it('handles keyboard navigation', async () => {
    const user = userEvent.setup()
    render(<Home />)

    const firstButton = screen.getAllByRole('button', { name: /Iniciar Análise Gratuita/ })[0]

    firstButton.focus()
    expect(document.activeElement).toBe(firstButton)

    await user.keyboard('{Tab}')
    expect(document.activeElement).not.toBe(firstButton) // Should move to next focusable element
  })

  it('renders without throwing errors', () => {
    expect(() => render(<Home />)).not.toThrow()
  })

  it('matches expected snapshot', () => {
    const { container } = render(<Home />)
    expect(container.firstChild).toMatchSnapshot()
  })
})
