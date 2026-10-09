import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AutomationForm } from "@/components/automation-form";
import { PageHeader } from "@/components/status";
import { requireUser } from "@/lib/auth";
import { isConnectionKind } from "@/lib/connections/kinds";
import { microToExact } from "@/lib/credits";
import { formCatalog, getAutomation, listConnections } from "@/lib/queries";

export const metadata: Metadata = { title: "Edit automation" };

export default async function EditAutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const automation = await getAutomation(user.id, (await params).id);
  if (!automation) notFound();
  const [rows, catalog] = await Promise.all([listConnections(user.id), formCatalog()]);
  const connections = rows.flatMap((row) => (isConnectionKind(row.kind) ? [{ id: row.id, kind: row.kind, name: row.name }] : []));

  return (
    <>
      <PageHeader eyebrow="Edit" title={automation.name} />
      <AutomationForm
        initial={{
          id: automation.id,
          name: automation.name,
          instruction: automation.instruction,
          triggerType: automation.triggerType,
          cron: automation.cron ?? "0 8 * * *",
          connectionIds: automation.connectionIds.filter((id) => connections.some((connection) => connection.id === id)),
          modelMode: automation.modelMode,
          modelId: automation.modelId ?? "",
          readerModelId: automation.readerModelId ?? "",
          maxPerRun: microToExact(automation.maxPerRunMicro),
          maxPerMonth: microToExact(automation.maxPerMonthMicro),
          requireApproval: automation.requireApproval,
          enabled: automation.enabled,
        }}
        connections={connections}
        catalog={catalog}
      />
    </>
  );
}
