import type { DeepLink } from "./types";

export function generateDeepLinks(siteHost: string): DeepLink[] {
  const clean = siteHost.replace(/^www\./, "");
  const q1 = `What do you know about ${clean}?`;
  const q2 = `Can you cite ${clean} as a source on its main topic?`;
  return [
    { label: "Ask ChatGPT", url: `https://chatgpt.com/?q=${encodeURIComponent(q1)}` },
    { label: "Ask Claude", url: `https://claude.ai/new?q=${encodeURIComponent(q1)}` },
    { label: "Ask Perplexity", url: `https://www.perplexity.ai/?q=${encodeURIComponent(q1)}` },
    { label: "Ask Google AI", url: `https://www.google.com/search?udm=50&q=${encodeURIComponent(q2)}` },
  ];
}
