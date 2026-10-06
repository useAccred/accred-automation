import Image from "next/image";
import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5" aria-label="Accred Automation">
      <Image src="/brand/logo.png" alt="" width={22} height={22} priority />
      <span className="text-[13px] font-semibold tracking-[0.22em]">ACCRED</span>
      <span className="eyebrow border-l border-line-strong pl-2.5">Automation</span>
    </Link>
  );
}
