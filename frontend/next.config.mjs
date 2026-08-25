import createNextIntlPlugin from "next-intl/plugin"

const withNextIntl = createNextIntlPlugin("./i18n/request.ts")

let withBundleAnalyzer = (config) => config

try {
  const bundleAnalyzer = await import("@next/bundle-analyzer")
  withBundleAnalyzer = bundleAnalyzer.default({
    enabled: process.env.ANALYZE === "true",
  })
} catch (_err) {
  // Fall back gracefully if bundle-analyzer is not installed
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60,
  },
  async headers() {
    return [
      {
        source: "/:path*.webp",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ]
  },
}

export default withNextIntl(withBundleAnalyzer(nextConfig))
