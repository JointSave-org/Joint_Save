import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import path from "path"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["__tests__/**/*.test.{ts,tsx}"],
    server: {
      deps: {
        inline: [/next-intl/],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: [
        "components/dashboard/transactions.tsx",
        "components/dashboard/yield-dashboard.tsx",
        "components/group/group-actions.tsx",
        "components/group/group-details.tsx",
        "components/create-group/flexible-form.tsx",
        "app/[locale]/dashboard/group/[id]/page.tsx",
        "lib/data-layer/PoolDataProvider.tsx",
        "hooks/useOptimisticTransactions.ts",
        "components/providers/web3-provider.tsx",
      ],
      exclude: [
        "node_modules/",
        "__tests__/",
        "**/*.test.{ts,tsx}",
        "**/*.config.{ts,js}",
        "**/test-utils.tsx",
        "**/__mocks__/**",
        ".next/",
        "e2e/",
      ],
      thresholds: {
        lines: 60,
        functions: 35,
        branches: 50,
        statements: 60,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
})
