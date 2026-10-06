import type { Metadata } from "next";
import Link from "next/link";
import { AutomationForm, type AutomationFormValues } from "@/components/automation-form";
import { PageHeader } from "@/components/status";
import { requireUser } from "@/lib/auth";
import { isConnectionKind, type ConnectionKind } from "@/lib/connections/kinds";
import { formCatalog, listConnections } from "@/lib/queries";
import { getTemplate } from "@/lib/templates";

export const metadata: Metadata = { title: "New automation" };

export default async function NewAutomationPage({ searchParams }: { searchParams: Promise<{ template?: string }> }) {
  const user = await requireUser();
  const template = getTemplate((await searchParams).template);
  const [rows, catalog] = await Promise.all([listConnections(user.id), formCatalog()]);
  const connections = rows.flatMap((row) => (isConnectionKind(row.kind) ? [{ id: row.id, kind: row.kind, name: row.name }] : []));

  // Preselect the first connection of each type the template uses.
  const preselected = (template?.connections ?? []).flatMap((kind: ConnectionKind) => {
    const match = connections.find((connection) => connection.kind === kind);
    return match ? [match.id] : [];
  });

  const initial: AutomationFormValues = {
    name: template?.name ?? "",
    instruction: template?.instruction ?? "",
    triggerType: template?.trigger.type ?? "schedule",
    cron: template?.trigger.type === "schedule" ? template.trigger.cron : "0 8 * * *",
    connectionIds: preselected,
    modelMode: "auto",
    modelId: "",
    readerModelId: "",
    maxPerRun: "10",
    maxPerMonth: "300",
    requireApproval: true,
    enabled: true,
  };

  return (
    <>
      <PageHeader
        eyebrow={template ? `Template · ${template.category}` : "New"}
        title={template ? template.name : "New automation"}
        description={
          template
            ? "The template filled this in. Change the links, numbers and wording to fit your case before you save."
            : "Describe the job, choose when it runs, and set what it may spend."
        }
        actions={
          <Link href="/app" className="btn btn-secondary">
            Back
          </Link>
        }
      />
      <AutomationForm key={template?.id ?? "blank"} initial={initial} connections={connections} catalog={catalog} wantedKinds={template?.connections} />
    </>
  );
}
