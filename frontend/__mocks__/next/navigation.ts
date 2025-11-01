const mockUsePathname = jest.fn(() => "/");

jest.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname()
}));