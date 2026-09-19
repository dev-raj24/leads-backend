export interface Offer {
  id: string;
  tenantId: string;
  siteId: string | null;
  title: string;
  body: string | null;
  active: boolean;
  color?: string;
  displayMode?: string;
  styleVariant?: string;
  actionType?: string;
  promoCode?: string;
  targetUrl?: string;
  whatsappNumber?: string;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
}
