export interface StatsOverview {
  totals: {
    leads: number;
    today: number;
    last7Days: number;
    previous7Days: number;
    won: number;
    waiting: number;
  };
  conversionRate: number;
  avgFirstReplySeconds: number | null;
  aiReplies: number;
  followupsOpen: number;
  daily: Array<{ date: string; leads: number; won: number }>;
  byStatus: Array<{ status: string; count: number }>;
  bySource: Array<{ source: string; count: number }>;
}
