import { buildApp } from "../src/app.js";

let app: any = null;

export default (req: any, res: any) => {
  return new Promise<void>((resolve, reject) => {
    res.on("finish", () => resolve());
    res.on("close", () => resolve());
    res.on("error", (err: any) => reject(err));

    const initAndHandle = async () => {
      if (!app) {
        app = await buildApp();
        await app.ready();
      }
      app.server.emit("request", req, res);
    };

    initAndHandle().catch((err: any) => {
      console.error("❌ Failed to initialize Fastify application:", err);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        error: "Initialization Error",
        message: err.message || String(err),
        stack: err.stack,
        hint: "Please ensure DATABASE_URL and other required environment variables are set in your Vercel project settings."
      }));
      resolve();
    });
  });
};
