import * as cheerio from "cheerio";

export type Severity = "critical" | "warning" | "info";

export interface SeoIssue {
  id: string;
  severity: Severity;
  message: string;
  fix: string;
  points: number;
}

export interface PageReport {
  url: string;
  status: number;
  title: string;
  description: string;
  h1: number;
  words: number;
  images: number;
  imagesWithoutAlt: number;
  internalLinks: string[];
  ms: number;
  score: number;
  issues: SeoIssue[];
  excerpt: string;
  headings: string[];
  missingAlt: Array<{ src: string; context: string }>;
}

const issue = (id: string, severity: Severity, points: number, message: string, fix: string): SeoIssue => ({ id, severity, points, message, fix });

export function analyzePage(input: { url: string; status: number; html: string; ms: number; bytes: number }): PageReport {
  const { url, status, html, ms, bytes } = input;
  const issues: SeoIssue[] = [];
  const $ = cheerio.load(html);

  const title = $("head > title").first().text().replace(/\s+/g, " ").trim();
  const description = ($('meta[name="description"]').attr("content") ?? "").replace(/\s+/g, " ").trim();
  const h1 = $("h1").length;
  const h2 = $("h2").length;
  const robots = ($('meta[name="robots"]').attr("content") ?? "").toLowerCase();
  const canonical = $('link[rel="canonical"]').attr("href");
  const viewport = $('meta[name="viewport"]').attr("content");
  const lang = $("html").attr("lang");
  const ogTitle = $('meta[property="og:title"]').attr("content");
  const jsonLd = $('script[type="application/ld+json"]').length;

  const images = $("img");
  const missingImages = images.filter((_, el) => ($(el).attr("alt") ?? "").trim() === "");
  const imagesWithoutAlt = missingImages.length;
  const missingAlt = missingImages
    .toArray()
    .slice(0, 8)
    .map((el) => {
      const heading = $(el).closest("section, article, div").find("h1, h2, h3").first().text();
      const caption = $(el).closest("figure").find("figcaption").text();
      return {
        src: ($(el).attr("src") ?? "").slice(0, 160),
        context: (caption || heading || $(el).parent().text()).replace(/\s+/g, " ").trim().slice(0, 100),
      };
    });
  const headings = $("h1, h2")
    .toArray()
    .slice(0, 8)
    .map((el) => $(el).text().replace(/\s+/g, " ").trim().slice(0, 100))
    .filter(Boolean);

  const origin = new URL(url);
  const internal = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript|sms):/i.test(href)) return;
    try {
      const target = new URL(href, url);
      if (!/^https?:$/.test(target.protocol)) return;
      if (target.hostname.replace(/^www\./, "") !== origin.hostname.replace(/^www\./, "")) return;
      if (/\.(jpe?g|png|gif|svg|webp|pdf|zip|css|js|ico|mp4|xml|txt)$/i.test(target.pathname)) return;
      target.hash = "";
      internal.add(target.toString());
    } catch {
      return;
    }
  });

  $("script, style, noscript, nav, footer").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const words = text ? text.split(" ").length : 0;
  const excerpt = text.slice(0, 700);

  if (status !== 200) issues.push(issue("status", "critical", 40, `The page answered with status ${status || "no response"}.`, "Make sure this page loads normally. Search engines drop pages that error."));
  if (!title) issues.push(issue("title_missing", "critical", 15, "The page has no title.", "Add a <title> of about 30 to 60 characters that says what the page is and includes your main keyword."));
  else if (title.length < 20 || title.length > 65) issues.push(issue("title_length", "warning", 5, `The title is ${title.length} characters.`, "Keep the title between 30 and 60 characters so Google shows all of it."));
  if (!description) issues.push(issue("description_missing", "critical", 12, "The page has no meta description.", "Add a meta description of 70 to 160 characters that makes someone want to click."));
  else if (description.length < 70 || description.length > 165) issues.push(issue("description_length", "warning", 4, `The meta description is ${description.length} characters.`, "Keep it between 70 and 160 characters."));
  if (h1 === 0) issues.push(issue("h1_missing", "critical", 10, "The page has no main heading (H1).", "Add one H1 that states the page's topic in plain words."));
  else if (h1 > 1) issues.push(issue("h1_multiple", "warning", 4, `The page has ${h1} H1 headings.`, "Use a single H1 and make the other headings H2 or H3."));
  if (!viewport) issues.push(issue("viewport", "critical", 8, "The page is not set up for phones (no viewport tag).", 'Add <meta name="viewport" content="width=device-width, initial-scale=1">. Google ranks on the mobile version.'));
  if (robots.includes("noindex")) issues.push(issue("noindex", "critical", 25, "This page tells Google not to list it (noindex).", "Remove the noindex tag if you want this page to appear in search."));
  if (!canonical) issues.push(issue("canonical", "warning", 3, "The page has no canonical link.", "Add a canonical link so Google knows which address is the main one."));
  if (url.startsWith("http://") && !/^http:\/\/(localhost|127\.)/.test(url)) issues.push(issue("https", "critical", 10, "The page is served without HTTPS.", "Install an SSL certificate and redirect http to https."));
  if (imagesWithoutAlt > 0) issues.push(issue("alt", "warning", Math.min(8, imagesWithoutAlt), `${imagesWithoutAlt} of ${images.length} images have no alt text.`, "Describe each meaningful image in its alt attribute. It helps image search and accessibility."));
  if (words < 200) issues.push(issue("thin", "warning", 8, `The page has only about ${words} words.`, "Add useful detail: services, prices, who you serve, common questions. Aim for 300 words or more."));
  else if (words < 300) issues.push(issue("thin_light", "info", 3, `The page has about ${words} words.`, "A little more detail would help this page rank. Aim for 300 words or more."));
  if (h2 === 0 && words >= 300) issues.push(issue("h2", "info", 2, "The page has no sub-headings.", "Break the page into sections with H2 headings."));
  if (!lang) issues.push(issue("lang", "info", 2, "The page does not declare its language.", 'Add lang="en" (or your language) to the <html> tag.'));
  if (!ogTitle) issues.push(issue("og", "info", 2, "No social sharing tags (Open Graph).", "Add og:title, og:description and og:image so links look good when shared."));
  if (jsonLd === 0) issues.push(issue("schema", "info", 2, "No structured data found.", "Add LocalBusiness or Organization structured data (JSON-LD) so Google understands your business."));
  if (ms > 2500) issues.push(issue("slow", "warning", 5, `The server took ${(ms / 1000).toFixed(1)} seconds to respond.`, "Speed up the server or add caching. Slow pages lose visitors and rank lower."));
  if (bytes > 500_000) issues.push(issue("heavy", "info", 3, `The HTML alone is ${Math.round(bytes / 1000)} KB.`, "Trim inline scripts and styles, or split the page."));

  const score = Math.max(0, 100 - issues.reduce((sum, i) => sum + i.points, 0));
  return { url, status, title, description, h1, words, images: images.length, imagesWithoutAlt, internalLinks: [...internal], ms, score, issues, excerpt, headings, missingAlt };
}

export interface SiteReport {
  score: number;
  pages: PageReport[];
  siteIssues: SeoIssue[];
  counts: { critical: number; warning: number; info: number; passedChecks: number };
}

export function summarizeSite(pages: PageReport[], site: { robotsBlocksAll: boolean; hasSitemap: boolean }): SiteReport {
  const siteIssues: SeoIssue[] = [];
  if (site.robotsBlocksAll) siteIssues.push(issue("robots_block", "critical", 20, "robots.txt blocks search engines from the whole site.", "Remove 'Disallow: /' for all user agents in robots.txt."));
  if (!site.hasSitemap) siteIssues.push(issue("sitemap", "warning", 5, "No sitemap.xml found.", "Create a sitemap.xml and submit it in Google Search Console."));

  const titles = pages.filter((p) => p.title).map((p) => p.title.toLowerCase());
  if (new Set(titles).size < titles.length) siteIssues.push(issue("dup_title", "warning", 5, "Some pages share the same title.", "Give every page its own title so Google can tell them apart."));
  const descriptions = pages.filter((p) => p.description).map((p) => p.description.toLowerCase());
  if (new Set(descriptions).size < descriptions.length) siteIssues.push(issue("dup_description", "warning", 3, "Some pages share the same meta description.", "Write a different description for each page."));

  const average = pages.length ? pages.reduce((s, p) => s + p.score, 0) / pages.length : 0;
  const score = Math.max(0, Math.round(average - siteIssues.reduce((s, i) => s + i.points, 0)));

  const all = [...pages.flatMap((p) => p.issues), ...siteIssues];
  const count = (sev: Severity) => all.filter((i) => i.severity === sev).length;
  const checksPerPage = 16;
  const passedChecks = Math.max(0, pages.length * checksPerPage - pages.reduce((s, p) => s + p.issues.length, 0));
  return { score, pages, siteIssues, counts: { critical: count("critical"), warning: count("warning"), info: count("info"), passedChecks } };
}
