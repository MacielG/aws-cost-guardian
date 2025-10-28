// Configure React act environment for Jest
global.IS_REACT_ACT_ENVIRONMENT = true

import '@testing-library/jest-dom'

// Mock Next.js router
jest.mock('next/router', () => ({
  useRouter() {
    return {
      route: '/',
      pathname: '/',
      query: '',
      asPath: '/',
      push: jest.fn(),
      pop: jest.fn(),
    }
  },
}))

// Mock next/image
jest.mock('next/image', () => ({
  __esModule: true,
  default: (props) => {
    // eslint-disable-next-line jsx-a11y/alt-text
    return <img {...props} />
  },
}))

// Mock AWS Amplify
jest.mock('aws-amplify', () => ({
  Amplify: {
    configure: jest.fn(),
  },
  Auth: {
    currentAuthenticatedUser: jest.fn(),
    signIn: jest.fn(),
    signOut: jest.fn(),
  },
}))

// Mock aws-amplify auth submodule used by AuthProvider (getCurrentUser, fetchAuthSession)
jest.mock('aws-amplify/auth', () => ({
  getCurrentUser: jest.fn(() => Promise.resolve({ username: 'test-user', userId: 'user-1' })),
  fetchAuthSession: jest.fn(() =>
    Promise.resolve({ tokens: { idToken: { payload: { email: 'test@example.com' } } } })
  ),
  signOut: jest.fn(() => Promise.resolve()),
}))

// Mock next/navigation (useRouter) so tests can call mockReturnValue on it when needed
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({ push: jest.fn() })),
  useSearchParams: jest.fn(() => ({ get: () => null })),
}))

// Global test utilities
global.fetch = jest.fn(() =>
  Promise.resolve({
    json: () => Promise.resolve([]),
    ok: true,
  })
)
