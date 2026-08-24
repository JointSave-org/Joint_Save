import Link from "next/link"

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-center">
      <div>
        <p className="mb-4 text-sm font-semibold uppercase tracking-wider text-primary">404</p>
        <h1 className="mb-6 text-4xl font-bold tracking-tight">Page Not Found</h1>
        <Link href="/" className="text-primary underline underline-offset-4">
          Back to Home
        </Link>
      </div>
    </div>
  )
}
