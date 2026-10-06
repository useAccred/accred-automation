import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/legal";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The terms for using Accred Automation.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="6 October 2026">
      <LegalSection heading="The service">
        <p>
          Accred Automation, a service of Accred, runs AI agents that carry out jobs you describe, on a schedule, when a webhook arrives, or
          when you start them. By using it you agree to these terms.
        </p>
      </LegalSection>

      <LegalSection heading="Your account and key">
        <ul>
          <li>You sign in with an Accred API key. Anyone who has that key can use your account here and spend its credit, so keep it private.</li>
          <li>You are responsible for what happens under your key. If it may have leaked, revoke it at accred.sh.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="Credits and charges">
        <ul>
          <li>Each model call an automation makes is paid from the Accred credits behind your key, at the price in the Accred catalog.</li>
          <li>
            The budget per run and the cap per month that you set are enforced before each model call. They limit what an automation can spend;
            they do not guarantee that a job finishes within them.
          </li>
          <li>Credits spent on a run are not refunded because the result was not what you wanted.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="What you are responsible for">
        <ul>
          <li>The instructions you write and what your automations do with them.</li>
          <li>Having the right to connect each account, bot, repository or API you link, and to use it this way.</li>
          <li>Reviewing actions before you approve them, and deciding whether to let an automation act without asking.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="AI output">
        <p>
          Agents are run by AI models, which can misread an instruction, miss something, or state something false. Check results that matter
          before relying on them. Content the agent reads from a web page or an email is treated as information, not as instructions, but no
          safeguard is complete.
        </p>
      </LegalSection>

      <LegalSection heading="Acceptable use">
        <p>Do not use the service to:</p>
        <ul>
          <li>send spam or messages people have not agreed to receive;</li>
          <li>access accounts, systems or data you are not authorised to use;</li>
          <li>break the law or the terms of the apps you connect;</li>
          <li>interfere with the service or try to get around its limits.</li>
        </ul>
        <p>We may pause or close an account that does.</p>
      </LegalSection>

      <LegalSection heading="Availability and liability">
        <p>
          The service is provided as it is. It may be changed, interrupted or discontinued, and a scheduled run may be late or missed. To the
          extent the law allows, Accred is not liable for indirect or consequential losses arising from use of the service, including actions
          taken by an automation you configured.
        </p>
      </LegalSection>

      <LegalSection heading="Your data">
        <p>
          How data is stored and used is described in the <Link href="/privacy">privacy policy</Link>. You can delete your account and its data
          at any time under Settings.
        </p>
      </LegalSection>

      <LegalSection heading="Changes and contact">
        <p>
          We may update these terms; the date above shows the latest version. Continuing to use the service after a change means you accept it.
          Write to <a href="mailto:contact@accred.sh">contact@accred.sh</a> with any question.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
