const LUNA_INPUT_USD_PER_MILLION = 0.2;
const LUNA_CACHED_INPUT_USD_PER_MILLION = 0.02;
const LUNA_OUTPUT_USD_PER_MILLION = 1.2;

export interface AiTokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
}

interface RoomUsage {
  spentUsd: number;
  reservedUsd: number;
}

interface BudgetState {
  usageDate: string;
  spentUsd: number;
  reservedUsd: number;
  requestCount: number;
  fallbackCount: number;
  activeRequests: number;
  requestTimestamps: number[];
  rooms: Map<string, RoomUsage>;
}

export interface AiBudgetStatus {
  dailyBudgetUsd: number;
  roomDailyBudgetUsd: number;
  spentUsd: number;
  remainingUsd: number;
  requestCount: number;
  fallbackCount: number;
  usageDate: string;
  resetAt: string;
}

export interface AiRequestReservation {
  complete: (usage?: AiTokenUsage) => void;
  cancel: (chargeReserved?: boolean) => void;
}

const utcDate = (now = Date.now()): string => new Date(now).toISOString().slice(0, 10);

const nextUtcMidnight = (now = Date.now()): string => {
  const current = new Date(now);
  return new Date(Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate() + 1
  )).toISOString();
};

const initialState = (): BudgetState => ({
  usageDate: utcDate(),
  spentUsd: 0,
  reservedUsd: 0,
  requestCount: 0,
  fallbackCount: 0,
  activeRequests: 0,
  requestTimestamps: [],
  rooms: new Map()
});

let state = initialState();

const resetIfNeeded = (now = Date.now()): void => {
  if (state.usageDate !== utcDate(now)) state = initialState();
};

const numberSetting = (
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number => {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
};

const dailyBudgetUsd = (): number =>
  numberSetting("OPENAI_DAILY_BUDGET_USD", 0.5, 0, 100_000);

const roomDailyBudgetUsd = (): number =>
  numberSetting("OPENAI_ROOM_DAILY_BUDGET_USD", 0.05, 0, 100_000);

const requestsPerMinute = (): number =>
  Math.floor(numberSetting("OPENAI_REQUESTS_PER_MINUTE", 30, 1, 10_000));

const maximumConcurrency = (): number =>
  Math.floor(numberSetting("OPENAI_MAX_CONCURRENCY", 2, 1, 100));

const finiteTokenCount = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};

export const calculateLunaCostUsd = (usage: AiTokenUsage): number => {
  const promptTokens = finiteTokenCount(usage.prompt_tokens);
  const completionTokens = finiteTokenCount(usage.completion_tokens);
  const cachedTokens = Math.min(
    promptTokens,
    finiteTokenCount(usage.prompt_tokens_details?.cached_tokens)
  );
  const uncachedTokens = promptTokens - cachedTokens;
  return (
    (uncachedTokens * LUNA_INPUT_USD_PER_MILLION)
    + (cachedTokens * LUNA_CACHED_INPUT_USD_PER_MILLION)
    + (completionTokens * LUNA_OUTPUT_USD_PER_MILLION)
  ) / 1_000_000;
};

const worstCaseCostUsd = (serializedMessages: string, maxOutputTokens: number): number => {
  // A token cannot contain less than one UTF-8 byte, so byte length is a conservative
  // upper bound. The extra allowance covers Chat Completions' internal message wrappers.
  const maximumInputTokens = Buffer.byteLength(serializedMessages, "utf8") + 512;
  return (
    (maximumInputTokens * LUNA_INPUT_USD_PER_MILLION)
    + (Math.max(0, maxOutputTokens) * LUNA_OUTPUT_USD_PER_MILLION)
  ) / 1_000_000;
};

const cleanRateWindow = (now: number): void => {
  const cutoff = now - 60_000;
  state.requestTimestamps = state.requestTimestamps.filter((timestamp) => timestamp > cutoff);
};

export const reserveAiRequest = (
  serializedMessages: string,
  maxOutputTokens: number,
  roomCode?: string
): AiRequestReservation | undefined => {
  const now = Date.now();
  resetIfNeeded(now);
  cleanRateWindow(now);

  if (state.activeRequests >= maximumConcurrency()) return undefined;
  if (state.requestTimestamps.length >= requestsPerMinute()) return undefined;

  const reservedUsd = worstCaseCostUsd(serializedMessages, maxOutputTokens);
  const globalLimit = dailyBudgetUsd();
  if (reservedUsd > globalLimit - state.spentUsd - state.reservedUsd) return undefined;

  const roomLimit = roomDailyBudgetUsd();
  const roomUsage = roomCode
    ? state.rooms.get(roomCode) ?? { spentUsd: 0, reservedUsd: 0 }
    : undefined;
  if (
    roomUsage
    && roomLimit > 0
    && reservedUsd > roomLimit - roomUsage.spentUsd - roomUsage.reservedUsd
  ) return undefined;

  state.reservedUsd += reservedUsd;
  state.activeRequests += 1;
  state.requestCount += 1;
  state.requestTimestamps.push(now);
  if (roomCode && roomUsage) {
    roomUsage.reservedUsd += reservedUsd;
    state.rooms.set(roomCode, roomUsage);
  }

  let finalized = false;
  const settle = (actualUsd: number): void => {
    if (finalized) return;
    finalized = true;
    const chargedUsd = Math.max(0, Math.min(reservedUsd, actualUsd));
    state.reservedUsd = Math.max(0, state.reservedUsd - reservedUsd);
    state.spentUsd += chargedUsd;
    state.activeRequests = Math.max(0, state.activeRequests - 1);
    if (roomCode && roomUsage) {
      roomUsage.reservedUsd = Math.max(0, roomUsage.reservedUsd - reservedUsd);
      roomUsage.spentUsd += chargedUsd;
      state.rooms.set(roomCode, roomUsage);
    }
  };

  return {
    complete: (usage) => settle(usage ? calculateLunaCostUsd(usage) : reservedUsd),
    cancel: (chargeReserved = false) => settle(chargeReserved ? reservedUsd : 0)
  };
};

export const recordAiFallback = (): void => {
  resetIfNeeded();
  state.fallbackCount += 1;
};

export const getAiBudgetStatus = (): AiBudgetStatus => {
  resetIfNeeded();
  const limit = dailyBudgetUsd();
  return {
    dailyBudgetUsd: limit,
    roomDailyBudgetUsd: roomDailyBudgetUsd(),
    spentUsd: Number(state.spentUsd.toFixed(6)),
    remainingUsd: Number(Math.max(0, limit - state.spentUsd - state.reservedUsd).toFixed(6)),
    requestCount: state.requestCount,
    fallbackCount: state.fallbackCount,
    usageDate: state.usageDate,
    resetAt: nextUtcMidnight()
  };
};
