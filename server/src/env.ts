import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = resolve(currentDirectory, "..");
export const REPOSITORY_ROOT = resolve(SERVER_ROOT, "..");

const candidates = [
  resolve(process.cwd(), ".env"),
  resolve(REPOSITORY_ROOT, ".env"),
  resolve(SERVER_ROOT, ".env")
];

for (const path of [...new Set(candidates)]) {
  if (existsSync(path)) dotenv.config({ path });
}
