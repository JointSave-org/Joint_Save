import Link from 'next/link';

export default function TermsPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
      <h1 className="text-4xl font-bold tracking-tight mb-4">Terms of Service</h1>
      <p className="text-muted-foreground max-w-md mb-8">
        We are currently drafting our official terms of service. Please check back soon, or reach out to us if you have immediate questions.
      </p>
      <Link 
        href="/" 
        className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
      >
        Return Home
      </Link>
    </div>
  );
}