import Link from "next/link";

export default function PrivacyPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
      <h1 className="mb-4 text-4xl font-bold tracking-tight">Privacy Policy</h1>
      <p className="mb-8 max-w-md text-muted-foreground">
        We are currently drafting our official privacy policy. Please check back
        soon, or reach out to us if you have immediate questions.
      </p>
      <Link
        href="/"
        className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-10 items-center justify-center rounded-md px-8 text-sm font-medium shadow transition-colors"
      >
        Return Home
      </Link>
    </div>
  );
}
