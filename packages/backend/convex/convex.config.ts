import { defineApp } from "convex/server";
import betterAuth from "@convex-dev/better-auth/convex.config";

const app = defineApp();

// Better Auth stores its own users/sessions/accounts tables inside this component.
app.use(betterAuth);

export default app;
