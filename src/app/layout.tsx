import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "https://automation.accred.sh"),
  title: {
    default: "Accred Automation — agents that pay per run",
    template: "%s · Accred Automation",
  },
  description:
    "Connect your apps, describe the job in plain words, and an agent runs it on a schedule. Every run is paid from your Accred credits with an exact receipt.",
  icons: { icon: "/brand/logo.png" },
};

export const viewport: Viewport = { themeColor: "#111110" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
