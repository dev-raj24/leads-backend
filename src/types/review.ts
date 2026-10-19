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
  email: string | null;
  locationId: string | null;
  locationName: string | null;
  needsReconnect: boolean;
}

export interface GoogleLocation {
  accountId: string;
  locationId: string;
  title: string;
}
