export type BlogPostStatus = "draft" | "published";

export interface BlogPost {
  id: string;
  tenantId: string;
  siteId: string | null;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  metaTitle: string | null;
  metaDescription: string | null;
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
  metaTitle: string;
  metaDescription: string;
}

export interface PublicBlogPost extends BlogPost {
  seoTitle: string;
  seoDescription: string;
}
