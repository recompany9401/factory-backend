import { createApp } from "./app";
import { assertEnv, env } from "./utils/env";
import { expirePendingReservations } from "./modules/expirePendingReservations";

function bootstrap() {
  assertEnv();

  const app = createApp();

  app.listen(env.PORT, () => {
    console.log(`[backend] listening on :${env.PORT} (${env.NODE_ENV})`);
  });

  const ttlMinutes = env.PENDING_TTL_MINUTES ?? 15;
  const intervalMinutes = env.PENDING_CLEANUP_INTERVAL_MINUTES ?? 5;

  setInterval(async () => {
    try {
      const result = await expirePendingReservations(ttlMinutes);
      if (result.expiredCount > 0) {
        console.log(
          `[expire] expired=${result.expiredCount} ttlMinutes=${ttlMinutes} cutoff=${result.cutoff}`,
        );
      }
    } catch (e) {
      console.error("[expire] failed", e);
    }
  }, intervalMinutes * 60_000);
}

bootstrap();
