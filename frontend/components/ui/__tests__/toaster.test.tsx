import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToasterProvider, useToaster } from '../toaster'

// Test component that uses the toaster
function TestComponent() {
  const { showToast } = useToaster()

  return (
    <div>
      <button
        onClick={() => showToast({ message: 'Test message', type: 'success' })}
        data-testid="show-toast-btn"
      >
        Show Toast
      </button>
    </div>
  )
}

describe('ToasterProvider', () => {
  it('renders children correctly', () => {
    render(
      <ToasterProvider>
        <div data-testid="child">Test Child</div>
      </ToasterProvider>
    )

    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('throws error when useToaster is used outside provider', () => {
    // Mock console.error to avoid noise in test output
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<TestComponent />)).toThrow(
      'useToaster must be used within ToasterProvider'
    )

    consoleSpy.mockRestore()
  })

  it('shows toast when showToast is called', async () => {
    const user = userEvent.setup()

    render(
      <ToasterProvider>
        <TestComponent />
      </ToasterProvider>
    )

    const button = screen.getByTestId('show-toast-btn')
    await user.click(button)

    // Check if toast appears
    await waitFor(() => {
      expect(screen.getByText('Test message')).toBeInTheDocument()
    })

    // Check if toast disappears after timeout
    await waitFor(
      () => {
        expect(screen.queryByText('Test message')).not.toBeInTheDocument()
      },
      { timeout: 4000 }
    )
  })

  it('renders toast with correct styling for success type', async () => {
    const user = userEvent.setup()

    render(
      <ToasterProvider>
        <TestComponent />
      </ToasterProvider>
    )

    const button = screen.getByTestId('show-toast-btn')
    await user.click(button)

    await waitFor(() => {
      const toast = screen.getByText('Test message')
      expect(toast).toBeInTheDocument()
      // Check if it has success styling (this depends on your toast component implementation)
      expect(toast.closest('div')).toHaveClass('bg-primary')
    })
  })
})
