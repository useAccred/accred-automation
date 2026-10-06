import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What Accred Automation stores, what it does with data from the apps you connect, and how to remove it.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="6 October 2026">
      <LegalSection heading="Who we are">
        <p>
          Accred Automation is a service of Accred that lets you describe a job in plain words and have an AI agent run it for you. This policy
          covers the app at agent.accred.sh. Questions go to <a href="mailto:contact@accred.sh">contact@accred.sh</a>.
        </p>
      </LegalSection>

      <LegalSection heading="What we store">
        <ul>
          <li>
            <strong>Your Accred API key.</strong> It identifies your account and pays for your runs. We store it encrypted, plus a one-way hash
            used to sign you in and its last four characters so you can recognise it.
          </li>
          <li>
            <strong>Your automations.</strong> The instruction you wrote, the trigger, the model choice, the credit budgets, and any short notes
            the agent saved between runs.
          </li>
          <li>
            <strong>Your connections.</strong> What is needed to act in the apps you link: a Telegram chat ID and, if you use your own bot, its
            token; a Slack or Discord webhook address; a GitHub token and repository name; an API address and header; for Gmail, your email
            address and the access grant Google issues. Secrets are stored encrypted and are never shown again.
          </li>
          <li>
            <strong>Run history.</strong> For each run: the steps the agent took, which model handled each step, the credits charged, the
            result, and a short excerpt of what each tool returned. Those excerpts can contain content from your connected apps, such as the
            sender and subject of an email. Payloads sent to a webhook trigger are stored with the run they started.
          </li>
          <li>
            <strong>A sign-in cookie.</strong> One cookie keeps you signed in. We set no advertising or analytics cookies.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Gmail and other Google data">
        <p>
          If you connect Gmail, we ask Google for <strong>read-only</strong> access to your mail. The app cannot send, delete or change email.
        </p>
        <ul>
          <li>We read your mail only while one of your automations runs, and only to carry out the instruction you wrote for it.</li>
          <li>
            The emails an automation reads are passed to the AI model that runs the job, through the Accred API, so the model can do what you
            asked. Short excerpts are saved in that run&apos;s history so you can see what the agent did.
          </li>
          <li>We do not sell Google data, use it for advertising, or use it to develop or train generalised AI models.</li>
          <li>
            Nobody at Accred reads your email, except with your permission to resolve a support request, when needed to investigate abuse or a
            security problem, or when the law requires it.
          </li>
        </ul>
        <p>
          Accred Automation&apos;s use and transfer of information received from Google APIs to any other app adheres to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
      </LegalSection>

      <LegalSection heading="Who receives your data">
        <ul>
          <li>
            <strong>AI model providers, through Accred.</strong> The instruction and whatever the agent reads during a run are sent to the model
            that handles each step.
          </li>
          <li>
            <strong>The apps you connect.</strong> When your automation sends a message or makes a change, that content goes to the app you
            chose, such as Telegram or GitHub.
          </li>
          <li>
            <strong>Our infrastructure providers.</strong> The app and its database run on hosting services that store data on our behalf.
          </li>
        </ul>
        <p>We do not sell your data or share it for advertising.</p>
      </LegalSection>

      <LegalSection heading="How long we keep it, and how to delete it">
        <ul>
          <li>Data stays until you remove it. Deleting an automation removes its run history.</li>
          <li>
            Removing a connection deletes its stored secret. Removing a Gmail connection also withdraws the access grant at Google. You can
            withdraw it yourself at any time at{" "}
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
              myaccount.google.com/permissions
            </a>
            .
          </li>
          <li>
            <strong>Delete account</strong>, under Settings, removes your automations, run history, connections and stored key from this
            service. Your Accred account and credits are separate and are not affected.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Security">
        <p>
          API keys, tokens and other connection secrets are encrypted before they are stored, and the app is served over HTTPS. Requests the
          agent makes on your behalf cannot reach private network addresses. No system is perfectly secure; if you believe your account has been
          misused, revoke the key at accred.sh and write to us.
        </p>
      </LegalSection>

      <LegalSection heading="Changes and contact">
        <p>
          If this policy changes in a way that affects how your data is used, we will update the date above and say so in the app. Write to{" "}
          <a href="mailto:contact@accred.sh">contact@accred.sh</a> with any question or request about your data.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
