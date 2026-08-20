"use client"

import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export function ExploreSkeleton() {
  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div className="space-y-2 mb-8">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-5 w-96" />
      </div>
      <div className="flex gap-3 mb-8">
        <Skeleton className="h-10 flex-1" />
        <Skeleton className="h-10 w-36" />
        <Skeleton className="h-10 w-36" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="p-6 h-64 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex justify-between">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-5 w-16" />
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
            <Skeleton className="h-9 w-full" />
          </Card>
        ))}
      </div>
    </div>
  )
}

export function GroupPageSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <div className="h-16 border-b border-border/40 bg-background/80 px-4 flex items-center justify-between">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-48" />
      </div>
      <main className="container mx-auto px-4 py-8 space-y-6">
        <Skeleton className="h-8 w-36 mb-6" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card className="p-6 h-64 space-y-4">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </Card>
            <Card className="p-6 h-80 space-y-4">
              <Skeleton className="h-6 w-36" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </Card>
          </div>
          <div className="space-y-6">
            <Card className="p-6 h-48 space-y-4">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-10 w-full" />
            </Card>
            <Card className="p-6 h-64 space-y-4">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </Card>
          </div>
        </div>
      </main>
    </div>
  )
}

export function AdminDashboardSkeleton() {
  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div className="flex justify-between items-center mb-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      <Card className="p-6 space-y-4">
        <Skeleton className="h-6 w-36 mb-4" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex justify-between items-center py-2 border-b border-border/50">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-32" />
          </div>
        ))}
      </Card>
    </div>
  )
}

export function AnalyticsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-9 w-44" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-6 space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-36" />
            <Skeleton className="h-3 w-24" />
          </Card>
        ))}
      </div>
      <Card className="p-6 h-80 space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-64 w-full" />
      </Card>
    </div>
  )
}

export function SecuritySkeleton() {
  return (
    <div className="container mx-auto px-4 py-16 space-y-12">
      <div className="max-w-2xl mx-auto text-center space-y-4">
        <Skeleton className="h-10 w-3/4 mx-auto" />
        <Skeleton className="h-5 w-full mx-auto" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card
            key={i}
            className="p-6 h-48 text-center flex flex-col items-center justify-center space-y-3"
          >
            <Skeleton className="h-12 w-12 rounded-xl" />
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-full" />
          </Card>
        ))}
      </div>
    </div>
  )
}

export function TransactionsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="space-y-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-44" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      <Card className="divide-y divide-border">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Skeleton className="h-12 w-12 rounded-xl" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-48" />
              </div>
            </div>
            <Skeleton className="h-6 w-24" />
          </div>
        ))}
      </Card>
    </div>
  )
}

export function YieldDashboardSkeleton() {
  return (
    <Card className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div className="space-y-2">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-60" />
        </div>
        <Skeleton className="h-6 w-20" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-4 space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-7 w-32" />
        </Card>
        <Card className="p-4 space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-7 w-32" />
        </Card>
      </div>
      <Skeleton className="h-10 w-full" />
    </Card>
  )
}

export function GroupActivitySkeleton() {
  return (
    <Card className="p-6 space-y-4">
      <div className="flex justify-between items-center">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-8 w-8" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 pb-3 border-b border-border/50">
            <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
