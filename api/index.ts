import { buildApp } from "../src/app.js";

let app: any = null;

export default async (req: any, res: any) => {
  if (!app) {
    try {
      app = await buildApp();
      await app.ready();
    } catch (err: any) {
      console.error("❌ Failed to initialize Fastify application:", err);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        error: "Initialization Error",
        message: err.message || String(err),
        stack: err.stack,
        hint: "Please ensure DATABASE_URL and other required environment variables are set in your Vercel project settings."
      }));
      return;
    }
  }

  app.server.emit("request", req, res);
};
