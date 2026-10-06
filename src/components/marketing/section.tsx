export function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-line">
      <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-[-0.03em] sm:text-[2.5rem] sm:leading-[1.1]">
          {title}
        </h2>
        {lead ? <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted sm:text-base">{lead}</p> : null}
        <div className="mt-10 sm:mt-14">{children}</div>
      </div>
    </section>
  );
}
