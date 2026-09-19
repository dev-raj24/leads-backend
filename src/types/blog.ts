export type BlogPostStatus = "draft" | "published";

export interface BlogPost {
  id: string;
  tenantId: string;
  siteId: string | null;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  status: BlogPostStatus;
  aiGenerated: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BlogDraft {
  title: string;
  excerpt: string;
  content: string;
}
