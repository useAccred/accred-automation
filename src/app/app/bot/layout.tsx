import { AppHeader } from "@/components/app-header";
import { requireUser } from "@/lib/auth";

/** The bot workspace fills the viewport below the header, like a desktop chat app. */
export default async function BotLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex h-dvh flex-col">
      <AppHeader user={user} wide />
      <main className="mx-auto flex w-full max-w-[1600px] min-h-0 flex-1 flex-col px-3 py-3 sm:px-4 sm:py-4">{children}</main>
    </div>
  );
}
