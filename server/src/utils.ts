import { randomInt } from "node:crypto";
import "./env.js";

export const GAME_TIME_SCALE = (() => {
  const parsed = Number(process.env.GAME_TIME_SCALE ?? "1");
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(0.001, parsed) : 1;
})();

export const scaledMs = (milliseconds: number): number =>
  Math.max(5, Math.round(milliseconds * GAME_TIME_SCALE));

export const randomBetween = (minimum: number, maximum: number): number => {
  if (maximum <= minimum) return minimum;
  return randomInt(minimum, maximum + 1);
};

export const randomFloat = (minimum = 0, maximum = 1): number =>
  minimum + Math.random() * (maximum - minimum);

export const pick = <T>(items: readonly T[]): T => {
  if (items.length === 0) throw new Error("Cannot pick from an empty array");
  return items[randomInt(0, items.length)] as T;
};

export const shuffle = <T>(items: readonly T[]): T[] => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapWith = randomInt(0, index + 1);
    [result[index], result[swapWith]] = [result[swapWith] as T, result[index] as T];
  }
  return result;
};

export const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const clampInt = (value: unknown, minimum: number, maximum: number, fallback: number): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
};

export const codePointLength = (value: string): number => Array.from(value).length;

export const truncateCodePoints = (value: string, maximum: number): string =>
  Array.from(value).slice(0, maximum).join("");
