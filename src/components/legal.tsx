import Link from "next/link";
import { Logo } from "@/components/logo";

/** Shared frame for the privacy policy and terms pages. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-5">
          <Logo />
          <Link href="/login" className="btn btn-secondary btn-sm">
            Open app
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12">
        <p className="eyebrow mb-3">Last updated {updated}</p>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <div className="mt-8 space-y-9">{children}</div>
      </main>
      <footer className="border-t border-line">
        <nav className="mx-auto flex w-full max-w-3xl flex-wrap gap-x-6 gap-y-2 px-5 py-6 text-[13px] text-muted" aria-label="Footer">
          <Link href="/" className="hover:text-foreground">
            Home
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            Terms
          </Link>
          <a href="mailto:contact@accred.sh" className="hover:text-foreground">
            contact@accred.sh
          </a>
        </nav>
      </footer>
    </div>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold tracking-tight">{heading}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-muted [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_li]:ml-5 [&_li]:list-disc [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:space-y-1.5">
        {children}
      </div>
    </section>
  );
}
