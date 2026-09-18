"use node";

import * as cheerio from "cheerio";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import { requireAuthSubject } from "./model/auth";

/**
 * Link enrichment — oEmbed and Open Graph, and nothing else.
 *
 * This is the phone app's `convex/preview.ts`, ported whole. It is the piece that turns a
 * pasted URL into a card with a title, a summary and a thumbnail, and it contains no AI:
 * every field comes from metadata the page itself published.
 *
 * The phone app layers an LLM on top of this (`convex/ai.ts`) to rewrite the title, write
 * a summary and assign tags. That layer is deliberately not ported — see docs/architecture.md. What
 * remains is the path the phone app already falls back to when a user is over their daily
 * AI quota, so it is a supported shape rather than an improvised one.
 *
 * `"use node"` because cheerio needs the Node runtime. A module with `"use node"` can only
 * export actions, which is why the mutation half of enrichment lives in artifacts.ts.
 */

const FETCH_TIMEOUT_MS = 6000;
const MAX_BYTES = 500_000; // og: tags live in <head>; the rest of the page is never needed

/**
 * The shape every platform fetcher and the generic scraper return.
 *
 * Author fields are best-effort — only some platforms expose them. `authorImage` is only
 * ever available from X/Twitter; no other source officially returns a profile picture.
 */
export type Metadata = {
  title: string;
  description?: string;
  image?: string;
  videoUrl?: string;
  authorName?: string;
  authorHandle?: string;
  authorUrl?: string;
  authorImage?: string;
};

const metadataValidator = v.object({
  title: v.string(),
  description: v.optional(v.string()),
  image: v.optional(v.string()),
  videoUrl: v.optional(v.string()),
  authorName: v.optional(v.string()),
  authorHandle: v.optional(v.string()),
  authorUrl: v.optional(v.string()),
  authorImage: v.optional(v.string()),
});

// ------------------------------------------------------------------- YouTube

function isYouTubeUrl(url: string) {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url);
}

async function fetchYouTubeMetadata(url: string): Promise<Metadata | null> {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  const res = await fetch(oembedUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    title?: string;
    thumbnail_url?: string;
    author_name?: string;
    author_url?: string;
  };
  return {
    title: data.title ?? "YouTube Video",
    image: data.thumbnail_url,
    videoUrl: url,
    authorName: data.author_name,
    // author_url is a channel handle URL like https://youtube.com/@handle
    authorHandle: data.author_url?.match(/@([^/?#]+)/)?.[1],
    authorUrl: data.author_url,
  };
}

// -------------------------------------------------------------------- TikTok

function isTikTokUrl(url: string) {
  return /^https?:\/\/(www\.|vm\.|vt\.)?tiktok\.com\//i.test(url);
}

async function resolveTikTokUrl(url: string): Promise<string> {
  // Strip tracking params — oEmbed rejects URLs with query strings. This has to apply
  // whichever branch below resolves the URL.
  if (/tiktok\.com\/@/i.test(url)) return url.split("?")[0] ?? url;

  const res = await fetch(url, {
    method: "HEAD",
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return res.url.split("?")[0] ?? url;
}

async function fetchTikTokMetadata(url: string): Promise<Metadata> {
  const resolvedUrl = await resolveTikTokUrl(url).catch(() => url);

  const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(resolvedUrl)}`;
  const res = await fetch(oembedUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (res.ok) {
    const data = (await res.json()) as {
      title?: string;
      author_name?: string;
      author_unique_id?: string;
      author_url?: string;
      thumbnail_url?: string;
    };
    return {
      title: data.title || data.author_name || "TikTok Video",
      image: data.thumbnail_url,
      authorName: data.author_name,
      authorHandle: data.author_unique_id,
      authorUrl: data.author_url,
    };
  }

  // Photo posts (and other non-video content): oEmbed answers 400. Fall through to the
  // generic scrape rather than returning empty — a slideshow still has an og:image.
  const scraped = await scrapeHtml(resolvedUrl).catch(() => null);
  const author = resolvedUrl.match(/tiktok\.com\/@([^/?#]+)/i)?.[1];
  return {
    title:
      scraped?.title && scraped.title !== resolvedUrl
        ? scraped.title
        : author
          ? `@${author} on TikTok`
          : "TikTok",
    image: scraped?.image,
    authorHandle: author,
    authorUrl: author ? `https://www.tiktok.com/@${author}` : undefined,
  };
}

// ------------------------------------------------------------------ X/Twitter

function isTwitterUrl(url: string) {
  return /^https?:\/\/(www\.)?(twitter\.com|x\.com)\//i.test(url);
}

function extractTweetIdAndUser(url: string): { username: string; id: string } | null {
  const match = url.match(/(?:twitter\.com|x\.com)\/([^/?#]+)\/status\/(\d+)/i);
  const [, username, id] = match ?? [];
  if (!username || !id) return null;
  return { username, id };
}

type FxTweetMedia = { type: string; url?: string; thumbnail_url?: string };

type FxTweetResponse = {
  code?: number;
  tweet?: {
    text?: string;
    author?: { name?: string; screen_name?: string; url?: string; avatar_url?: string };
    media?: { videos?: FxTweetMedia[]; photos?: FxTweetMedia[] };
  };
};

async function fetchFxTwitter(url: string): Promise<Metadata | null> {
  const parsed = extractTweetIdAndUser(url);
  if (!parsed) return null;

  const apiUrl = `https://api.fxtwitter.com/${parsed.username}/status/${parsed.id}`;
  const res = await fetch(apiUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return null;

  const tweet = ((await res.json()) as FxTweetResponse).tweet;
  if (!tweet) return null;

  const authorName = tweet.author?.name ?? "X Post";
  const title = tweet.text ? `${authorName}: ${tweet.text.slice(0, 80)}` : authorName;

  // X is the only source that officially exposes a profile picture.
  const author = {
    authorName: tweet.author?.name,
    authorHandle: tweet.author?.screen_name,
    authorUrl: tweet.author?.url,
    authorImage: tweet.author?.avatar_url,
  };

  const video = tweet.media?.videos?.[0];
  if (video) {
    return { title, image: video.thumbnail_url, videoUrl: video.url, ...author };
  }

  return { title, image: tweet.media?.photos?.[0]?.url, ...author };
}

// ----------------------------------------------------------------- Instagram

function isInstagramUrl(url: string) {
  return /^https?:\/\/(www\.)?(instagram\.com|instagr\.am)\//i.test(url);
}

/**
 * Instagram's oEmbed is the only official way to read metadata from an arbitrary public
 * post URL. It needs a Meta app access token (`{app-id}|{client-token}`) in
 * INSTAGRAM_OEMBED_TOKEN. Unset is not an error — the generic scrape takes over.
 *
 * It returns a cover thumbnail and the author's username. It does NOT return a profile
 * picture, a direct video URL, or every image of a carousel.
 */
async function fetchInstagramMetadata(url: string): Promise<Metadata | null> {
  const token = process.env.INSTAGRAM_OEMBED_TOKEN;
  if (!token) return null;

  const oembedUrl =
    `https://graph.facebook.com/v21.0/instagram_oembed?url=${encodeURIComponent(url)}` +
    `&fields=author_name,thumbnail_url,title&omitscript=true&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(oembedUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    author_name?: string;
    thumbnail_url?: string;
    title?: string;
  };
  if (!data.thumbnail_url && !data.author_name) return null;

  const handle = data.author_name;
  return {
    title: data.title || (handle ? `@${handle} on Instagram` : "Instagram"),
    image: data.thumbnail_url,
    authorName: handle,
    authorHandle: handle,
    authorUrl: handle ? `https://www.instagram.com/${handle}/` : undefined,
  };
}

// ----------------------------------------------------------------- Pinterest

function isPinterestUrl(url: string) {
  return /^https?:\/\/(www\.)?(pinterest\.[a-z.]+|pin\.it)\//i.test(url);
}

async function fetchPinterestMetadata(url: string): Promise<Metadata | null> {
  const oembedUrl = `https://www.pinterest.com/oembed.json?url=${encodeURIComponent(url)}`;
  const res = await fetch(oembedUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    title?: string;
    author_name?: string;
    author_url?: string;
    thumbnail_url?: string;
  };
  if (!data.thumbnail_url && !data.title) return null;

  return {
    title: data.title || "Pinterest",
    image: data.thumbnail_url,
    authorName: data.author_name,
    authorHandle: data.author_url?.match(/pinterest\.[a-z.]+\/([^/?#]+)/i)?.[1],
    authorUrl: data.author_url,
  };
}

// ------------------------------------------------------------ generic scrape

async function scrapeHtml(url: string): Promise<Metadata> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
          "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      },
    });

    if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
    if (!response.body) throw new Error("Empty response body");

    // Stream and stop at </head>, so a 4MB page costs a few KB.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let html = "";
    let bytesRead = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.length;
      html += decoder.decode(value, { stream: true });
      if (html.includes("</head>") || bytesRead >= MAX_BYTES) {
        await reader.cancel().catch(() => {});
        break;
      }
    }

    const $ = cheerio.load(html);

    const rawTitle =
      $('meta[property="og:title"]').attr("content") ??
      $('meta[name="twitter:title"]').attr("content") ??
      $("title").text();

    const rawDescription =
      $('meta[property="og:description"]').attr("content") ??
      $('meta[name="twitter:description"]').attr("content") ??
      $('meta[name="description"]').attr("content");

    const rawImage =
      $('meta[name="twitter:player:image"]').attr("content") ??
      $('meta[property="og:image"]').attr("content") ??
      $('meta[name="twitter:image"]').attr("content");

    let image: string | undefined;
    if (rawImage) {
      try {
        image = new URL(rawImage, url).toString();
      } catch {
        image = rawImage;
      }
      // A profile picture is not a thumbnail of the thing being saved.
      if (image?.includes("/profile_images/")) image = undefined;
    }

    return {
      title: rawTitle?.trim() || "Untitled",
      description: rawDescription?.trim() || undefined,
      image,
      videoUrl: $('meta[name="twitter:player:stream"]').attr("content") ?? undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Platform-specific first, generic scrape last.
 *
 * Every platform branch is `.catch(() => null)` and falls through rather than failing: an
 * oEmbed endpoint can be rate-limited, a post can be private, a token can be missing, and
 * in all three cases og: tags are still better than nothing.
 */
export async function scrapeMetadata(url: string): Promise<Metadata> {
  if (/\.(jpe?g|png|gif|webp|avif)(\?|$)/i.test(url)) {
    return { title: "Image", image: url };
  }

  if (isYouTubeUrl(url)) {
    const result = await fetchYouTubeMetadata(url).catch(() => null);
    if (result) return result;
  }

  if (isTikTokUrl(url)) {
    const result = await fetchTikTokMetadata(url).catch(() => null);
    if (result) return result;
  }

  if (isTwitterUrl(url)) {
    const result = await fetchFxTwitter(url).catch(() => null);
    if (result) return result;
  }

  if (isInstagramUrl(url)) {
    const result = await fetchInstagramMetadata(url).catch(() => null);
    if (result) return result;
  }

  if (isPinterestUrl(url)) {
    const result = await fetchPinterestMetadata(url).catch(() => null);
    if (result) return result;
  }

  return await scrapeHtml(url);
}

// ----------------------------------------------------------------- functions

/**
 * Preview a URL before committing to keeping it — what the add sheet renders while you
 * are still deciding.
 *
 * Signed-in only. It is an unauthenticated outbound fetch to a caller-chosen URL, which
 * is a small open proxy if anyone can reach it.
 */
export const preview = action({
  args: { url: v.string() },
  returns: metadataValidator,
  handler: async (ctx, { url }): Promise<Metadata> => {
    await requireAuthSubject(ctx);

    try {
      return await scrapeMetadata(url);
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === "AbortError";
      throw new Error(
        isTimeout ? "That site took too long to respond." : "Could not read that link.",
      );
    }
  },
});

/**
 * The scheduled half: fill in an artifact that was saved as a bare URL.
 *
 * Failure is recorded rather than swallowed. The phone repo logs and returns, which
 * leaves the row `pending` forever and the card spinning; `failed` is what the "Could not
 * process" chip on the card is for.
 */
export const enrichArtifact = internalAction({
  args: { artifactId: v.id("artifacts") },
  returns: v.null(),
  handler: async (ctx, { artifactId }) => {
    const artifact = await ctx.runQuery(internal.artifacts.getInternal, { artifactId });
    if (!artifact?.source) return null;

    try {
      const scraped = await scrapeMetadata(artifact.source);
      await ctx.runMutation(internal.artifacts.applyEnrichment, {
        artifactId,
        title: scraped.title,
        description: scraped.description,
        imageUrl: scraped.image,
        videoUrl: scraped.videoUrl,
        authorName: scraped.authorName,
        authorHandle: scraped.authorHandle,
        authorUrl: scraped.authorUrl,
        authorImage: scraped.authorImage,
        status: "ready",
      });
    } catch {
      // No error detail in the log line: the URL is the user's, and the message can carry
      // fragments of a page they saved privately.
      await ctx.runMutation(internal.artifacts.applyEnrichment, {
        artifactId,
        status: "failed",
      });
    }
    return null;
  },
});
