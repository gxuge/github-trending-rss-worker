const RSS_BASE_URL = "https://gxuge.github.io/GitHubTrendingRSS";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname !== "/" && url.pathname !== "/trending") {
      return json({ error: "not_found" }, 404);
    }

    const token = url.searchParams.get("token");
    if (env.AUTH_TOKEN && token !== env.AUTH_TOKEN) {
      return json({ error: "unauthorized" }, 401);
    }

    const since = url.searchParams.get("since") || "daily";
    const language = (url.searchParams.get("language") || "all").toLowerCase();
    const raw = url.searchParams.get("raw") === "1";

    if (!["daily", "weekly", "monthly"].includes(since)) {
      return json({
        error: "invalid_since",
        allowed: ["daily", "weekly", "monthly"]
      }, 400);
    }

    if (!/^[a-z0-9+#.\-]+$/.test(language)) {
      return json({ error: "invalid_language" }, 400);
    }

    const rssUrl = `${RSS_BASE_URL}/${since}/${language}.xml`;

    const cacheKey = new Request(url.toString(), request);
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const res = await fetch(rssUrl, {
      headers: {
        "User-Agent": "GitHub-Trending-RSS-Worker/1.0",
        "Accept": "application/rss+xml, application/xml, text/xml"
      }
    });

    if (!res.ok) {
      return json({
        error: "rss_fetch_failed",
        status: res.status,
        rssUrl
      }, 502);
    }

    const xml = await res.text();

    if (raw) {
      const response = new Response(xml, {
        status: 200,
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "public, max-age=1800"
        }
      });
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }

    const items = parseRssItems(xml);

    const output = {
      source: "GitHubTrendingRSS",
      rssBaseUrl: RSS_BASE_URL,
      since,
      language,
      rssUrl,
      count: items.length,
      items,
      fetchedAt: new Date().toISOString()
    };

    const response = json(output, 200, {
      "Cache-Control": "public, max-age=1800"
    });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }
};

function parseRssItems(xml) {
  const blocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);

  return blocks.map((block, index) => {
    const title = text(block, "title");
    const link = text(block, "link");
    const descriptionRaw = text(block, "description");
    const pubDate = text(block, "pubDate");

    const repoFullName = parseRepoFromLink(link) || normalizeRepoName(title);
    const [owner = "", repo = ""] = repoFullName.split("/");

    return {
      rank: index + 1,
      title,
      repoFullName,
      owner,
      repo,
      url: link,
      description: stripHtml(descriptionRaw),
      pubDate
    };
  });
}

function text(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  if (!m) return "";
  return decodeXml(m[1].trim());
}

function parseRepoFromLink(link) {
  const m = link.match(/github\.com\/([^/]+\/[^/?#]+)/);
  return m ? m[1] : "";
}

function normalizeRepoName(title) {
  return title.replace(/\s+/g, "").trim();
}

function stripHtml(s) {
  return decodeXml(
    s
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function decodeXml(s) {
  return s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}