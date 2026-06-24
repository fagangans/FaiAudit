import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { router as apiRouter } from "./routes/api.js";
import { router as authRouter } from "./routes/auth.js";
import { router as adminRouter } from "./routes/admin.js";
import { bootstrapMasterAccount } from "./bootstrapMaster.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/auth", authLimiter, authRouter);
app.use("/api/admin", adminRouter);
app.use("/api", apiRouter);

const port = process.env.PORT || 3000;

bootstrapMasterAccount().finally(() => {
  app.listen(port, () => {
    console.log(`[FaiAudit] dashboard berjalan di http://localhost:${port}`);
  });
});
