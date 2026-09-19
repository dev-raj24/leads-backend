// routes/index.ts — mounts every resource router under /api.
import { Router } from "express";
import { authRoutes } from "./auth.routes";
import { blogRoutes } from "./blog.routes";
import { chatRoutes } from "./chat.routes";
import { followupRoutes } from "./followup.routes";
import { leadRoutes } from "./lead.routes";
import { offerRoutes } from "./offer.routes";
import { siteRoutes } from "./site.routes";

export const apiRoutes = Router();

apiRoutes.use(authRoutes);
apiRoutes.use(siteRoutes);
apiRoutes.use(leadRoutes);
apiRoutes.use(offerRoutes);
apiRoutes.use(followupRoutes);
apiRoutes.use(chatRoutes);
apiRoutes.use(blogRoutes);
