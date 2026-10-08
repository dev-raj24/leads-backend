// services/blog.service.ts — business logic + RAW SQL for AI blog posts.
// Rule: raw SQL lives ONLY here. Every query is parametrized and every
// owner-facing query is scoped by tenant_id.

import { completeText } from "../config/gemini";
import { getBusinessProfile } from "./ai-config.service";
import { query } from "../config/db";
import { AppError } from "../utils/errors";
import type { BlogDraft, BlogPost, BlogPostStatus, PublicBlogPost } from "../types";

interface BlogPostRow {
  id: string;
  tenant_id: string;
  site_id: string | null;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  meta_title: string | null;
  meta_description: string | null;
  status: string;
  ai_generated: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

function toBlogPost(row: BlogPostRow): BlogPost {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    siteId: row.site_id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    content: row.content,
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,
    status: row.status as BlogPostStatus,
    aiGenerated: row.ai_generated,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text.trim());

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "post";
}

/** AI-drafts a full post from a topic. Requires GEMINI_API_KEY. */
export async function generateDraft(tenantId: string, topic: string): Promise<BlogDraft> {
  const { businessName, profile } = await getBusinessProfile(tenantId);
  const serviceNames = profile.services.map((s) => s.name).join(", ");
  const text = await completeText({
    maxTokens: 3000,
    system:
      `You write blog posts for small local businesses (dental clinics, salons, real ` +
      `estate agents, coaches) using a product called Leadworks. You are writing for ` +
      `${businessName}${profile.about ? ` (${profile.about})` : ""}${serviceNames ? `; services: ${serviceNames}` : ""}. Write a complete, ` +
      `ready-to-publish post for the given topic — warm, helpful, locally relevant, no ` +
      `fluff. Respond with ONLY a JSON object, no markdown fences, no commentary, shaped ` +
      `exactly like: {"title": "...", "excerpt": "one or two sentence summary", ` +
      `"metaTitle": "SEO title under 60 characters with the main keyword", ` +
      `"metaDescription": "SEO meta description under 155 characters that makes a searcher click", ` +
      `"content": "full post body, plain paragraphs separated by \\n\\n; start a section heading line with ## "}`,
    messages: [{ role: "user", content: `Topic: ${topic}` }],
  }).catch((err) => {
    if (err instanceof AppError) throw err;
    console.error("[blog.generateDraft]", err);
    throw new AppError(502, "generation_failed");
  });

  try {
    const parsed = JSON.parse(text);
    const title = typeof parsed.title === "string" ? parsed.title : topic;
    const excerpt = typeof parsed.excerpt === "string" ? parsed.excerpt : "";
    return {
      title,
      excerpt,
      content: typeof parsed.content === "string" ? parsed.content : text,
      metaTitle: clip(typeof parsed.metaTitle === "string" && parsed.metaTitle.trim() ? parsed.metaTitle : title, 60),
      metaDescription: clip(typeof parsed.metaDescription === "string" && parsed.metaDescription.trim() ? parsed.metaDescription : excerpt, 160),
    };
  } catch {
    return { title: topic, excerpt: "", content: text, metaTitle: clip(topic, 60), metaDescription: "" };
  }
}

export async function getBlogPostsForTenant(tenantId: string): Promise<BlogPost[]> {
  const rows = await query<BlogPostRow>(
    `select * from blog_posts where tenant_id = $1 order by created_at desc`,
    [tenantId]
  );
  return rows.map(toBlogPost);
}

export async function getBlogPostById(tenantId: string, id: string): Promise<BlogPost | null> {
  const rows = await query<BlogPostRow>(
    `select * from blog_posts where id = $2 and tenant_id = $1 limit 1`,
    [tenantId, id]
  );
  return rows[0] ? toBlogPost(rows[0]) : null;
}

export async function createBlogPost(
  tenantId: string,
  siteId: string | null,
  input: {
    title: string;
    excerpt?: string;
    content: string;
    status?: BlogPostStatus;
    aiGenerated?: boolean;
    metaTitle?: string;
    metaDescription?: string;
  }
): Promise<BlogPost> {
  const base = slugify(input.title);
  const status = input.status ?? "draft";
  let slug = base;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const rows = await query<BlogPostRow>(
        `insert into blog_posts (tenant_id, site_id, title, slug, excerpt, content, status, ai_generated, meta_title, meta_description, published_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, case when $7 = 'published' then now() else null end)
         returning *`,
        [
          tenantId,
          siteId,
          input.title,
          slug,
          input.excerpt ?? null,
          input.content,
          status,
          input.aiGenerated ?? false,
          input.metaTitle ?? null,
          input.metaDescription ?? null,
        ]
      );
      return toBlogPost(rows[0]);
    } catch (err) {
      const pgError = err as { code?: string };
      if (pgError?.code === "23505" && attempt < 4) {
        slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
        continue;
      }
      throw err;
    }
  }
  throw new Error("Failed to create blog post — slug collisions exhausted retries.");
}

export async function updateBlogPost(
  tenantId: string,
  id: string,
  input: { title?: string; excerpt?: string; content?: string; status?: BlogPostStatus; metaTitle?: string; metaDescription?: string }
): Promise<BlogPost | null> {
  const existing = await getBlogPostById(tenantId, id);
  if (!existing) return null;

  const nextStatus = input.status ?? existing.status;
  const publishedAt =
    nextStatus === "published" ? existing.publishedAt ?? new Date().toISOString() : null;

  const rows = await query<BlogPostRow>(
    `update blog_posts
     set title = coalesce($3, title),
         excerpt = coalesce($4, excerpt),
         content = coalesce($5, content),
         meta_title = coalesce($8, meta_title),
         meta_description = coalesce($9, meta_description),
         status = $6,
         published_at = $7,
         updated_at = now()
     where id = $2 and tenant_id = $1
     returning *`,
    [
      tenantId,
      id,
      input.title ?? null,
      input.excerpt ?? null,
      input.content ?? null,
      nextStatus,
      publishedAt,
      input.metaTitle ?? null,
      input.metaDescription ?? null,
    ]
  );
  return rows[0] ? toBlogPost(rows[0]) : null;
}

export async function deleteBlogPost(tenantId: string, id: string): Promise<boolean> {
  const rows = await query(
    `delete from blog_posts where id = $2 and tenant_id = $1 returning id`,
    [tenantId, id]
  );
  return rows.length > 0;
}

// ---- public reads (embed widget on the tenant's own website, no auth) -----

export async function getPublishedPostsForSiteKey(siteKey: string): Promise<BlogPost[]> {
  const rows = await query<BlogPostRow>(
    `select bp.* from blog_posts bp
     join sites s on s.id = bp.site_id
     join tenants t on t.id = bp.tenant_id and t.plan = 'pro'
     where s.api_key = $1 and bp.status = 'published'
     order by bp.published_at desc`,
    [siteKey]
  );
  return rows.map(toBlogPost);
}

export async function getPublishedPostBySlug(
  siteKey: string,
  slug: string
): Promise<BlogPost | null> {
  const rows = await query<BlogPostRow>(
    `select bp.* from blog_posts bp
     join sites s on s.id = bp.site_id
     join tenants t on t.id = bp.tenant_id and t.plan = 'pro'
     where s.api_key = $1 and bp.slug = $2 and bp.status = 'published'
     limit 1`,
    [siteKey, slug]
  );
  return rows[0] ? toBlogPost(rows[0]) : null;
}

// ---- public pages on our own domain (/b/<slug>) -----------------------------

export interface PublicBlogSite {
  businessName: string;
  publicSlug: string;
  posts: PublicBlogPost[];
}

const firstWords = (text: string, max: number) => clip(text.replace(/\s+/g, " ").trim(), max);

const withSeo = (post: BlogPost): PublicBlogPost => ({
  ...post,
  seoTitle: post.metaTitle?.trim() || post.title,
  seoDescription: post.metaDescription?.trim() || post.excerpt?.trim() || firstWords(post.content, 155),
});

export async function getPublicBlogSite(publicSlug: string): Promise<PublicBlogSite | null> {
  const sites = await query<{ id: string; name: string; public_slug: string }>(
    `select s.id, t.name, s.public_slug from sites s
     join tenants t on t.id = s.tenant_id and t.plan = 'pro'
     where s.public_slug = $1 limit 1`,
    [publicSlug]
  );
  if (!sites[0]) return null;
  const rows = await query<BlogPostRow>(
    `select * from blog_posts where site_id = $1 and status = 'published' order by published_at desc`,
    [sites[0].id]
  );
  return { businessName: sites[0].name, publicSlug: sites[0].public_slug, posts: rows.map(toBlogPost).map(withSeo) };
}

export async function getPublicBlogPost(publicSlug: string, postSlug: string): Promise<{ businessName: string; post: PublicBlogPost } | null> {
  const rows = await query<BlogPostRow & { business: string }>(
    `select bp.*, t.name as business from blog_posts bp
     join sites s on s.id = bp.site_id
     join tenants t on t.id = bp.tenant_id and t.plan = 'pro'
     where s.public_slug = $1 and bp.slug = $2 and bp.status = 'published' limit 1`,
    [publicSlug, postSlug]
  );
  return rows[0] ? { businessName: rows[0].business, post: withSeo(toBlogPost(rows[0])) } : null;
}
