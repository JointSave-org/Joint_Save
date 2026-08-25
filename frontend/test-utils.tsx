import React, { ReactElement } from "react"
import { render, RenderOptions } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { NextIntlClientProvider } from "next-intl"
import { Web3Provider } from "@/components/web3-provider"
import { PoolDataProvider } from "@/lib/data-layer/PoolDataProvider"
import { ThemeProvider } from "next-themes"
import { Toaster } from "@/components/ui/toaster"
import messages from "@/messages/en.json"

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

interface AllTheProvidersProps {
  children: React.ReactNode
}

export function AllTheProviders({ children }: AllTheProvidersProps) {
  const queryClient = createTestQueryClient()
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <Web3Provider>
            <PoolDataProvider>
              {children}
              <Toaster />
            </PoolDataProvider>
          </Web3Provider>
        </ThemeProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>
  )
}

const customRender = (ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  render(ui, { wrapper: AllTheProviders, ...options })

export * from "@testing-library/react"
export { customRender as render }
