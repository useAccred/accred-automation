import { AppHeader } from "@/components/app-header";
import { requireUser } from "@/lib/auth";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex flex-1 flex-col">
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:py-10">{children}</main>
    </div>
  );
}
