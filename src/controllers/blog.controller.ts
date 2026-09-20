// controllers/blog.controller.ts — req/res + input validation for the AI blog.
// Rule: NO SQL here. This layer only shapes HTTP in/out and calls services.

import type { Request, Response } from "express";
import * as blogService from "../services/blog.service";
import * as siteService from "../services/site.service";
import type { BlogPostStatus } from "../types";
import { asyncHandler } from "../utils/asyncHandler";
import { badRequest, notFound } from "../utils/errors";
import { isNonEmptyString, limitLength, optionalString } from "../utils/validate";

const MAX_TITLE = 200;
const MAX_EXCERPT = 500;
const MAX_CONTENT = 100_000;

const isValidStatus = (v: unknown): v is BlogPostStatus => v === "draft" || v === "published";

/** POST /api/blog/generate — { topic } -> { draft: { title, excerpt, content } } */
export const generate = asyncHandler(async (req: Request, res: Response) => {
  const topic = optionalString(req.body?.topic);
  if (!topic) throw badRequest("missing_topic");
  limitLength(topic, 300, "topic_too_long");
  res.json({ draft: await blogService.generateDraft(req.tenantId!, topic) });
});

/** GET /api/blog — the owner's own posts, draft + published. */
export const list = asyncHandler(async (req: Request, res: Response) => {
  res.json({ posts: await blogService.getBlogPostsForTenant(req.tenantId!) });
});

/** GET /api/blog/:id */
export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const post = await blogService.getBlogPostById(req.tenantId!, req.params.id);
  if (!post) throw notFound();
  res.json({ post });
});

/** POST /api/blog — { title, excerpt?, content, status?, aiGenerated? } */
export const create = asyncHandler(async (req: Request, res: Response) => {
  const { title, excerpt, content, status, aiGenerated } = req.body ?? {};
  if (!isNonEmptyString(title)) throw badRequest("missing_title");
  if (!isNonEmptyString(content)) throw badRequest("missing_content");
  if (status !== undefined && !isValidStatus(status)) throw badRequest("invalid_status");
  limitLength(title, MAX_TITLE, "title_too_long");
  limitLength(content, MAX_CONTENT, "content_too_long");
  if (typeof excerpt === "string") limitLength(excerpt, MAX_EXCERPT, "excerpt_too_long");

  const site = await siteService.getPrimarySiteForTenant(req.tenantId!);
  const post = await blogService.createBlogPost(req.tenantId!, site?.id ?? null, {
    title,
    excerpt: optionalString(excerpt),
    content,
    status,
    aiGenerated: Boolean(aiGenerated),
  });
  res.status(201).json({ post });
});

/** PATCH /api/blog/:id — { title?, excerpt?, content?, status? } */
export const update = asyncHandler(async (req: Request, res: Response) => {
  const { title, excerpt, content, status } = req.body ?? {};
  if (status !== undefined && !isValidStatus(status)) throw badRequest("invalid_status");
  if (typeof title === "string") limitLength(title, MAX_TITLE, "title_too_long");
  if (typeof content === "string") limitLength(content, MAX_CONTENT, "content_too_long");
  if (typeof excerpt === "string") limitLength(excerpt, MAX_EXCERPT, "excerpt_too_long");

  const post = await blogService.updateBlogPost(req.tenantId!, req.params.id, {
    title: optionalString(title),
    excerpt: typeof excerpt === "string" ? excerpt : undefined,
    content: optionalString(content),
    status,
  });
  if (!post) throw notFound();
  res.json({ post });
});

/** DELETE /api/blog/:id */
export const remove = asyncHandler(async (req: Request, res: Response) => {
  if (!(await blogService.deleteBlogPost(req.tenantId!, req.params.id))) throw notFound();
  res.json({ ok: true });
});

// ---- public — the embed script on the tenant's own website reads these ---

/** GET /api/public/blog?siteKey=... — published posts only. */
export const publicList = asyncHandler(async (req: Request, res: Response) => {
  const siteKey = req.query.siteKey;
  if (!isNonEmptyString(siteKey)) throw badRequest("missing_site_key");
  res.json({ posts: await blogService.getPublishedPostsForSiteKey(siteKey) });
});

/** GET /api/public/blog/:slug?siteKey=... — a single published post. */
export const publicGet = asyncHandler(async (req: Request, res: Response) => {
  const siteKey = req.query.siteKey;
  if (!isNonEmptyString(siteKey)) throw badRequest("missing_site_key");
  const post = await blogService.getPublishedPostBySlug(siteKey, req.params.slug);
  if (!post) throw notFound();
  res.json({ post });
});
