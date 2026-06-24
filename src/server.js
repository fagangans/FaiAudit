import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { router as apiRouter } from "./routes/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/api", apiRouter);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`[FaiAudit] dashboard berjalan di http://localhost:${port}`);
});
