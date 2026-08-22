// controllers/blog.controller.ts — req/res + input validation for the AI blog.
// Rule: NO SQL here. This layer only shapes HTTP in/out and calls services.

import type { Request, Response } from "express";
import * as blogService from "../services/blog.service";
import * as siteService from "../services/site.service";
import type { BlogPostStatus } from "../types";

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isValidStatus(v: unknown): v is BlogPostStatus {
  return v === "draft" || v === "published";
}

/** POST /api/blog/generate — { topic } -> { draft: { title, excerpt, content } } */
export async function generate(req: Request, res: Response) {
  if (!req.tenantId) return res.status(401).json({ error: "missing_tenant" });

  const { topic } = req.body ?? {};
  if (!isNonEmptyString(topic)) {
    return res.status(400).json({ error: "missing_topic" });
  }

  try {
    const draft = await blogService.generateDraft(topic.trim());
    return res.json({ draft });
  } catch (err) {
    console.error("[blog.controller.generate]", err);
    return res.status(500).json({ error: "generation_failed" });
  }
}

/** GET /api/blog — the owner's own posts, draft + published. */
export async function list(req: Request, res: Response) {
  if (!req.tenantId) return res.status(401).json({ error: "missing_tenant" });
  try {
    const posts = await blogService.getBlogPostsForTenant(req.tenantId);
    return res.json({ posts });
  } catch (err) {
    console.error("[blog.controller.list]", err);
    return res.status(500).json({ error: "internal_error" });
  }
}

/** GET /api/blog/:id */
export async function getOne(req: Request, res: Response) {
  if (!req.tenantId) return res.status(401).json({ error: "missing_tenant" });
  try {
    const post = await blogService.getBlogPostById(req.tenantId, req.params.id);
    if (!post) return res.status(404).json({ error: "not_found" });
    return res.json({ post });
  } catch (err) {
    console.error("[blog.controller.getOne]", err);
    return res.status(500).json({ error: "internal_error" });
  }
}

/** POST /api/blog — { title, excerpt?, content, status?, aiGenerated? } */
export async function create(req: Request, res: Response) {
  if (!req.tenantId) return res.status(401).json({ error: "missing_tenant" });

  const { title, excerpt, content, status, aiGenerated } = req.body ?? {};
  if (!isNonEmptyString(title)) return res.status(400).json({ error: "missing_title" });
  if (!isNonEmptyString(content)) return res.status(400).json({ error: "missing_content" });
  if (status !== undefined && !isValidStatus(status)) {
    return res.status(400).json({ error: "invalid_status" });
  }

  try {
    const site = await siteService.getPrimarySiteForTenant(req.tenantId);
    const post = await blogService.createBlogPost(req.tenantId, site?.id ?? null, {
      title,
      excerpt: isNonEmptyString(excerpt) ? excerpt : undefined,
      content,
      status,
      aiGenerated: Boolean(aiGenerated),
    });
    return res.status(201).json({ post });
  } catch (err) {
    console.error("[blog.controller.create]", err);
    return res.status(500).json({ error: "internal_error" });
  }
}

/** PATCH /api/blog/:id — { title?, excerpt?, content?, status? } */
export async function update(req: Request, res: Response) {
  if (!req.tenantId) return res.status(401).json({ error: "missing_tenant" });

  const { title, excerpt, content, status } = req.body ?? {};
  if (status !== undefined && !isValidStatus(status)) {
    return res.status(400).json({ error: "invalid_status" });
  }

  try {
    const post = await blogService.updateBlogPost(req.tenantId, req.params.id, {
      title: isNonEmptyString(title) ? title : undefined,
      excerpt: typeof excerpt === "string" ? excerpt : undefined,
      content: isNonEmptyString(content) ? content : undefined,
      status,
    });
    if (!post) return res.status(404).json({ error: "not_found" });
    return res.json({ post });
  } catch (err) {
    console.error("[blog.controller.update]", err);
    return res.status(500).json({ error: "internal_error" });
  }
}

/** DELETE /api/blog/:id */
export async function remove(req: Request, res: Response) {
  if (!req.tenantId) return res.status(401).json({ error: "missing_tenant" });
  try {
    const deleted = await blogService.deleteBlogPost(req.tenantId, req.params.id);
    if (!deleted) return res.status(404).json({ error: "not_found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[blog.controller.remove]", err);
    return res.status(500).json({ error: "internal_error" });
  }
}

// ---- public — the embed script on the tenant's own website reads these ---

/** GET /api/public/blog?siteKey=... — published posts only. */
export async function publicList(req: Request, res: Response) {
  const siteKey = req.query.siteKey;
  if (!isNonEmptyString(siteKey)) return res.status(400).json({ error: "missing_site_key" });
  try {
    const posts = await blogService.getPublishedPostsForSiteKey(siteKey);
    return res.json({ posts });
  } catch (err) {
    console.error("[blog.controller.publicList]", err);
    return res.status(500).json({ error: "internal_error" });
  }
}

/** GET /api/public/blog/:slug?siteKey=... — a single published post. */
export async function publicGet(req: Request, res: Response) {
  const siteKey = req.query.siteKey;
  if (!isNonEmptyString(siteKey)) return res.status(400).json({ error: "missing_site_key" });
  try {
    const post = await blogService.getPublishedPostBySlug(siteKey, req.params.slug);
    if (!post) return res.status(404).json({ error: "not_found" });
    return res.json({ post });
  } catch (err) {
    console.error("[blog.controller.publicGet]", err);
    return res.status(500).json({ error: "internal_error" });
  }
}
