"use client";

import { useState } from "react";
import {
  MessageCircle,
  Link2,
  Check,
} from "lucide-react";

interface ShareButtonsProps {
  postId: string;
  url: string;
  title: string;
}

const platforms = [
  {
    key: "twitter" as const,
    label: "Twitter / X",
    icon: null,
    displayIcon: "𝕏",
    getShareUrl: (url: string, title: string) =>
      `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
  },
  {
    key: "linkedin" as const,
    label: "LinkedIn",
    icon: null,
    displayIcon: "in",
    getShareUrl: (url: string, title: string) =>
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
  },
  {
    key: "whatsapp" as const,
    label: "WhatsApp",
    icon: MessageCircle,
    getShareUrl: (url: string, title: string) =>
      `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`,
  },
] as const;

export function ShareButtons({ postId, url, title }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);

  function trackShare(platform: string) {
    fetch(`/api/stats/share/${postId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform }),
    }).catch(() => {});
  }

  function handlePlatformClick(platform: (typeof platforms)[number]) {
    trackShare(platform.key);
    window.open(platform.getShareUrl(url, title), "_blank", "noopener,noreferrer,width=600,height=400");
  }

  async function handleCopyLink() {
    trackShare("copy_link");
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {platforms.map((platform) => (
        <button
          key={platform.key}
          onClick={() => handlePlatformClick(platform)}
          aria-label={`Share on ${platform.label}`}
          className="flex h-10 w-10 items-center justify-center border border-ora-sand text-ora-charcoal-light hover:bg-ora-cream-light hover:text-ora-charcoal transition-colors focus-visible:ring-2 focus-visible:ring-ora-gold focus-visible:ring-offset-2 text-sm font-semibold"
        >
          {platform.icon ? (
            <platform.icon className="h-4 w-4 stroke-1" />
          ) : (
            <span>{(platform as any).displayIcon}</span>
          )}
        </button>
      ))}
      <button
        onClick={handleCopyLink}
        aria-label={copied ? "Link copied" : "Copy link"}
        className={`flex h-10 w-10 items-center justify-center border transition-colors focus-visible:ring-2 focus-visible:ring-ora-gold focus-visible:ring-offset-2 ${
          copied
            ? "border-ora-success/30 bg-ora-success/10 text-ora-success"
            : "border-ora-sand text-ora-charcoal-light hover:bg-ora-cream-light hover:text-ora-charcoal"
        }`}
      >
        {copied ? (
          <Check className="h-4 w-4 stroke-1" />
        ) : (
          <Link2 className="h-4 w-4 stroke-1" />
        )}
      </button>
    </div>
  );
}
