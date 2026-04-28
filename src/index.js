const RSS_BASE_URL = "https://gxuge.github.io/GitHubTrendingRSS";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== "/" && url.pathname !== "/trending") {
      return json({ error: "not_found", path: url.pathname }, 404);
    }

    const token = url.searchParams.get("token");
    if (env.AUTH_TOKEN && token !== env.AUTH_TOKEN) {
      return json({ error: "unauthorized" }, 401);
    }

    const since = url.searchParams.get("since") || "weekly";
    const language = (url.searchParams.get("language") || "all").toLowerCase();

    if (!["daily", "weekly", "monthly"].includes(since)) {
      return json({ error: "invalid_since" }, 400);
    }

    if (!/^[a-z0-9+#.\-]+$/.test(language)) {
      return json({ error: "invalid_language" }, 400);
    }

    const rssUrl = `${RSS_BASE_URL}/${since}/${language}.xml`;

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
    const items = parseRssItems(xml);

    return json({
      ok: true,
      source: "GitHubTrendingRSS",
      rssUrl,
      since,
      language,
      count: items.length,
      items,
      fetchedAt: new Date().toISOString()
    });
  }
};

function parseRssItems(xml) {
  const blocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);

  return blocks.map((block, index) => {
    const title = getTag(block, "title");
    const link = getTag(block, "link");
    const descriptionRaw = getTag(block, "description");
    const pubDate = getTag(block, "pubDate");

    const repoFullName = parseRepoFromLink(link) || title;
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

function getTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

function parseRepoFromLink(link) {
  const match = link.match(/github\.com\/([^/]+\/[^/?#]+)/i);
  return match ? match[1] : "";
}

function stripHtml(value) {
  return decodeXml(
    value
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function decodeXml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}