import tseslint from "typescript-eslint"
import nextPlugin from "@next/eslint-plugin-next"
import reactHooksPlugin from "eslint-plugin-react-hooks"
import prettierConfig from "eslint-config-prettier"

export default tseslint.config(
  // Files to lint
  {
    files: ["**/*.ts", "**/*.tsx"],
  },

  // Next.js core-web-vitals flat config (includes @next/next plugin + rules)
  nextPlugin.configs["core-web-vitals"],

  // TypeScript recommended rules
  ...tseslint.configs.recommended,

  // React hooks rules
  {
    plugins: {
      "react-hooks": reactHooksPlugin,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // Project-specific rule overrides
  {
    rules: {
      "no-console": "warn",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  // Prettier must be last — disables all formatting rules that could conflict
  prettierConfig,

  // Ignore patterns
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "e2e/**", "playwright.config.ts"],
  }
)
