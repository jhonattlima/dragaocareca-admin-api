import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import dotenv from "dotenv";

const execFileAsync = promisify(execFile);

const envFile =
  process.env.NODE_ENV === "production"
    ? ".env.production"
    : process.env.NODE_ENV === "development"
      ? ".env.dev"
      : ".env";

dotenv.config({ path: envFile });

const scriptPath = path.resolve(process.cwd(), "src", "scripts", "spotify-metrics.py");

const run = async (): Promise<void> => {
  try {
    const { stdout, stderr } = await execFileAsync("python3", [scriptPath], {
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (stderr) {
      process.stderr.write(stderr);
    }

    process.stdout.write(stdout);
  } catch (error) {
    if (error && typeof error === "object") {
      const maybe = error as { stdout?: string; stderr?: string; message?: string };
      if (maybe.stdout) process.stdout.write(maybe.stdout);
      if (maybe.stderr) process.stderr.write(maybe.stderr);
      if (maybe.message) console.error(maybe.message);
    } else {
      console.error(String(error));
    }
    process.exit(1);
  }
};

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
