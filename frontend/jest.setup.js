// Adiciona mock para IntersectionObserver para silenciar warnings do 'act'
const mockIntersectionObserver = jest.fn();
mockIntersectionObserver.mockReturnValue({
  observe: () => null,
  unobserve: () => null,
  disconnect: () => null,
});
window.IntersectionObserver = mockIntersectionObserver;

// Mock ResizeObserver para ambientes jsdom (recharts e componentes que usam)
// jsdom não implementa ResizeObserver por padrão; adicionar um mock simples
// evita ReferenceError durante os testes.
global.ResizeObserver = global.ResizeObserver || class {
  constructor(callback) {
    this.callback = callback;
  }
  observe() { }
  unobserve() { }
  disconnect() { }
};

// Mock framer-motion for ambiente de teste (jsdom).
// The real library injects animation props (whileHover, initial, animate, variants, etc.)
// which are not valid DOM attributes and cause React warnings in tests. Here we
// provide passthrough components that filter those animation-specific props before
// forwarding to DOM elements.
jest.mock('framer-motion', () => {
  const React = require('react')

  const ANIMATION_PROPS = new Set([
    'initial', 'animate', 'exit', 'whileHover', 'whileTap', 'whileInView', 'variants', 'transition', 'layout', 'layoutId'
  ])

  const makeTag = (tagName) => {
    return ({ children, ...props }) => {
      // Filter animation-specific props so React doesn't warn about unknown DOM attrs
      const safeProps = Object.keys(props).reduce((acc, key) => {
        if (!ANIMATION_PROPS.has(key)) acc[key] = props[key];
        return acc;
      }, {});
      return React.createElement(tagName || 'div', safeProps, children);
    }
  }

  const motion = new Proxy({}, {
    get: (_target, prop) => {
      const tag = typeof prop === 'string' ? prop : 'div'
      return makeTag(tag)
    }
  })

  const useSpring = (initial = 0) => {
    let value = initial
    return {
      set(v) { value = v },
      get() { return value },
      subscribe() { return { unsubscribe() {} } },
    }
  }

  const useTransform = (input, mapper) => {
    const inputValue = typeof input?.get === 'function' ? input.get() : Number(input || 0)
    const mapped = typeof mapper === 'function' ? mapper(inputValue) : inputValue
    return {
      get() { return mapped },
      toString() { return String(mapped) },
    }
  }

  return {
    __esModule: true,
    motion,
    useSpring,
    useTransform,
  }
})

// Mock parts of recharts used in our components. ResponsiveContainer in jsdom
// often has zero size which leads to warnings; provide a stable container with
// explicit width/height for tests to avoid those warnings.
jest.mock('recharts', () => {
  const React = require('react')
  // Simple mocks for recharts components used in the app. We intentionally do
  // not forward chart-specific props to DOM elements to avoid React warnings
  // about unknown attributes in jsdom.
  const Neutral = ({ children }) => React.createElement('div', {}, children)
  return {
    __esModule: true,
    ResponsiveContainer: ({ children }) => React.createElement('div', { style: { width: 800, height: 600 } }, children),
    BarChart: Neutral,
    Bar: Neutral,
    XAxis: Neutral,
    YAxis: Neutral,
    Tooltip: Neutral,
    CartesianGrid: Neutral,
  }
})

// Imports existentes
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
