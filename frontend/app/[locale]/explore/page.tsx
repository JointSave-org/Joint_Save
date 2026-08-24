"use client"

import { Suspense } from "react"
import { useTranslations } from "next-intl"
import dynamic from "next/dynamic"
import { ErrorBoundary } from "@/components/error-boundary"
import { ExploreSkeleton } from "@/components/ui/loading-skeletons"

const ExploreView = dynamic(
  () => import("@/components/explore/explore-view").then((mod) => mod.ExploreContent),
  {
    ssr: false,
    loading: () => <ExploreSkeleton />,
  }
)

// useSearchParams requires a Suspense boundary at the page level.
export default function ExplorePage() {
  const t = useTranslations("explore")
  return (
    <Suspense fallback={<ExploreSkeleton />}>
      <ErrorBoundary sectionName={t("explorePools")}>
        <ExploreView />
      </ErrorBoundary>
    </Suspense>
  )
}
