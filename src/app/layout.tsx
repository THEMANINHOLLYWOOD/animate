import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Anton, Archivo_Black, Inter, JetBrains_Mono, Permanent_Marker, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { AccountProvider } from "@/components/Account";
import { CLERK_ENABLED } from "@/lib/authMode";
import { SITE } from "@/lib/site";

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

const DESCRIPTION = "Describe it. Drop in your files. Get a film.";

// What a shared link shows. The picture comes from opengraph-image.png and twitter-image.png beside
// this file, the icons from favicon.ico, icon.svg and apple-icon.png; the video is the launch film,
// which closes on the frame it opens with, so it loops where a player repeats it.
export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "animate",
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    url: "/",
    siteName: "animate",
    title: "animate",
    description: DESCRIPTION,
    // (A video is given its whole address: it isn't resolved against metadataBase the way a picture is.)
    videos: [{ url: `${SITE}/share/animate.mp4`, secureUrl: `${SITE}/share/animate.mp4`, type: "video/mp4", width: 1280, height: 720 }],
  },
  twitter: { card: "summary_large_image", title: "animate", description: DESCRIPTION },
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
