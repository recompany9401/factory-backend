import express from "express";
import cors from "cors";
import router from "./routes";
import path from "path";
import portoneWebhookRouter from "./routes/portoneWebhook";
import notificationRouter from "./routes/notification";
import adminRouter from "./routes/admin";
import popupRouter from "./routes/popups";
import dashboardRouter from "./routes/dashboard";
import postRouter from "./routes/posts";
import resourceRouter from "./routes/resources";
import scheduleRouter from "./routes/schedules";

export function createApp() {
  const app = express();
  app.use(cors());

  app.use("/api/webhooks/portone", express.text({ type: "application/json" }));

  app.use("/api/webhooks/portone", portoneWebhookRouter);

  app.use(express.json());

  app.use("/api/notifications", notificationRouter);

  app.use("/api/admin", adminRouter);

  app.use("/api/resources", resourceRouter);

  app.use("/api", router);

  app.use("/uploads", express.static(path.join(__dirname, "../../uploads")));

  app.use("/api/popups", popupRouter);

  app.use("/api/admin/dashboard", dashboardRouter);

  app.use("/api/posts", postRouter);

  app.use("/api/schedules", scheduleRouter);

  app.use((_req, res) => res.status(404).json({ message: "Not Found" }));
  return app;
}
