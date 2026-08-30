import { defineRouting } from "next-intl/routing"

export const routing = defineRouting({
  locales: ["en", "es"],
  defaultLocale: "en",
  localeCookie: {
    name: "NEXT_LOCALE",
  },
})

export type Locale = (typeof routing.locales)[number]
