import { app } from "./app";
import { config } from "./config/env";
import { connectDb } from "./db/connect";

const bootstrap = async (): Promise<void> => {
  await connectDb();
  app.listen(config.port, () => {
    console.log(`dragaocareca-admin-api running on port ${config.port}`);
  });
};

bootstrap().catch((error: unknown) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
