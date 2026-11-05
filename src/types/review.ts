export type ReviewStatus = "pending" | "sent" | "skipped";

export interface GoogleReview {
  id: string;
  reviewId: string;
  reviewerName: string | null;
  rating: number | null;
  comment: string | null;
  createTime: string | null;
  aiDraft: string | null;
  status: ReviewStatus;
  sentReply: string | null;
  sentAt: string | null;
}

export interface ReviewConnectionStatus {
  configured: boolean;
  connected: boolean;
  businessName: string | null;
  address: string | null;
}

export interface BusinessMatch {
  dataId: string;
  title: string;
  address: string | null;
  rating: number | null;
  reviewCount: number | null;
}
