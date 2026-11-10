import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Anton, Archivo_Black, Inter, JetBrains_Mono, Permanent_Marker, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { AccountProvider } from "@/components/Account";
import { CLERK_ENABLED } from "@/lib/authMode";

const serif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
});
const sans = Inter({ variable: "--font-sans", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"] });
// Faces films draw with (the kit's 'display', 'heavy' and 'marker' families).
const display = Anton({ variable: "--font-display", subsets: ["latin"], weight: "400" });
const heavy = Archivo_Black({ variable: "--font-heavy", subsets: ["latin"], weight: "400" });
const marker = Permanent_Marker({ variable: "--font-marker", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: "animate",
  description: "Describe it, drop in your files, get a film.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${serif.variable} ${sans.variable} ${mono.variable} ${display.variable} ${heavy.variable} ${marker.variable}`}
    >
      <body>
        {CLERK_ENABLED ? (
          <ClerkProvider
            appearance={{
              variables: {
                colorPrimary: "#141413",
                colorBackground: "#FAF9F5",
                colorForeground: "#141413",
                borderRadius: "12px",
                fontFamily: "var(--font-sans), system-ui, sans-serif",
              },
            }}
          >
            <AccountProvider>{children}</AccountProvider>
          </ClerkProvider>
        ) : (
          <AccountProvider>{children}</AccountProvider>
        )}
      </body>
    </html>
  );
}
