// routes/index.ts — mounts every resource router under /api.
import { Router } from "express";
import { aiConfigRoutes } from "./ai-config.routes";
import { authRoutes } from "./auth.routes";
import { billingRoutes } from "./billing.routes";
import { blogRoutes } from "./blog.routes";
import { chatRoutes } from "./chat.routes";
import { customerRoutes } from "./customer.routes";
import { followupRoutes } from "./followup.routes";
import { inboundEmailRoutes } from "./inbound-email.routes";
import { leadRoutes } from "./lead.routes";
import { offerRoutes } from "./offer.routes";
import { siteRoutes } from "./site.routes";
import { statsRoutes } from "./stats.routes";
import { tenantRoutes } from "./tenant.routes";
import { unsubscribeRoutes } from "./unsubscribe.routes";
import { widgetChatRoutes } from "./widget-chat.routes";
import { widgetRoutes } from "./widget.routes";

export const apiRoutes = Router();

apiRoutes.use(authRoutes);
apiRoutes.use(aiConfigRoutes);
apiRoutes.use(siteRoutes);
apiRoutes.use(leadRoutes);
apiRoutes.use(customerRoutes);
apiRoutes.use(offerRoutes);
apiRoutes.use(followupRoutes);
apiRoutes.use(chatRoutes);
apiRoutes.use(blogRoutes);
apiRoutes.use(statsRoutes);
apiRoutes.use(tenantRoutes);
apiRoutes.use(widgetRoutes);
apiRoutes.use(unsubscribeRoutes);
apiRoutes.use(billingRoutes);
apiRoutes.use(inboundEmailRoutes);
apiRoutes.use(widgetChatRoutes);
