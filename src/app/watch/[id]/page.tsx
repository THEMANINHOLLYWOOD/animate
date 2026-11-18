import type { Metadata } from "next";
import Link from "next/link";
import { readShare, signedVideoUrl } from "@/lib/share";
import { SITE } from "@/lib/site";
import "./watch.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const share = await readShare((await params).id);
  if (!share) return { title: "animate", description: "Made with animate." };
  const title = `${share.title} · animate`;
  // A shared film's link shows that film: its video where the app plays one, the site's picture elsewhere.
  return {
    title,
    description: "Made with animate.",
    openGraph: {
      type: "video.other",
      url: `/watch/${share.id}`,
      siteName: "animate",
      title,
      description: "Made with animate.",
      images: ["/opengraph-image.png"],
      videos: [{ url: `${SITE}/api/share?id=${share.id}`, secureUrl: `${SITE}/api/share?id=${share.id}`, type: "video/mp4", width: share.w, height: share.h }],
    },
    twitter: { card: "summary_large_image", title, description: "Made with animate.", images: ["/twitter-image.png"] },
  };
}

export default async function Watch({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const share = await readShare(id);
  if (!share) {
    return (
      <main className="watch">
        <p className="watch-missing">This link is no longer available.</p>
        <Link className="watch-cta" href="/">
          Make your own film
        </Link>
      </main>
    );
  }
  const src = await signedVideoUrl(share);
  return (
    <main className="watch">
      <header className="watch-top">
        <Link href="/" className="brand">
          animate
        </Link>
      </header>
      <div className="watch-frame" style={{ aspectRatio: `${share.w} / ${share.h}` }}>
        <video src={src} controls autoPlay muted playsInline loop />
      </div>
      <div className="watch-meta">
        <h1>{share.title}</h1>
        <p>
          {share.w}×{share.h}
          {share.duration ? ` · ${share.duration}s` : ""}
        </p>
        <div className="watch-actions">
          <a className="watch-btn" href={`/api/share?id=${share.id}&dl=1`}>
            Download MP4
          </a>
          <Link className="watch-cta" href="/">
            Make your own →
          </Link>
        </div>
      </div>
    </main>
  );
}
