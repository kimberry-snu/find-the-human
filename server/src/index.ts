import { createServer, type IncomingMessage } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { getAiRuntimeStatus } from "./ai.js";
import { REPOSITORY_ROOT } from "./env.js";
import { GameEngine } from "./game.js";
import type { Ack, GameSocket } from "./types.js";

const app = express();
app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "32kb" }));

app.get("/health", (_request, response) => {
  response.status(200).json({ ok: true, ai: getAiRuntimeStatus() });
});

const clientDist = resolve(REPOSITORY_ROOT, "client", "dist");
const clientIndex = resolve(clientDist, "index.html");
if (existsSync(clientIndex)) {
  app.use(express.static(clientDist, { index: false }));
  app.get("*", (_request, response) => response.sendFile(clientIndex));
} else {
  app.get("/", (_request, response) => {
    response.status(200).json({
      name: "인간을 찾아라 server",
      ready: true,
      clientBuilt: false
    });
  });
}

const httpServer = createServer(app);

const clientOrigins = (process.env.CLIENT_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)
  .map((origin) => {
    try {
      return new URL(origin).origin;
    } catch {
      return origin.replace(/\/$/, "");
    }
  });
const clientOriginSet = new Set(clientOrigins);
const rateLimitsDisabled = process.env.RATE_LIMIT_DISABLED === "1";

const firstHeaderValue = (value: string | string[] | undefined): string | undefined => {
  const first = Array.isArray(value) ? value[0] : value?.split(",")[0];
  return first?.trim() || undefined;
};

const clientIp = (request: IncomingMessage): string => {
  const forwarded = firstHeaderValue(request.headers["x-forwarded-for"]);
  const address = forwarded ?? request.socket.remoteAddress ?? "unknown";
  return address.replace(/^::ffff:/, "").slice(0, 128);
};

const isAllowedRequestOrigin = (request: IncomingMessage): boolean => {
  if (clientOriginSet.size === 0) return true;

  const origin = firstHeaderValue(request.headers.origin);
  if (!origin) return true;

  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    return false;
  }
  if (clientOriginSet.has(normalizedOrigin)) return true;

  // A separately hosted client must be listed in CLIENT_ORIGIN. A client served
  // by this Express process is same-origin and does not need to be duplicated.
  const host = firstHeaderValue(request.headers["x-forwarded-host"]) ?? firstHeaderValue(request.headers.host);
  if (!host) return false;
  const protocol =
    firstHeaderValue(request.headers["x-forwarded-proto"]) ??
    ((request.socket as typeof request.socket & { encrypted?: boolean }).encrypted ? "https" : "http");

  return normalizedOrigin === `${protocol}://${host}`;
};

const MAX_SOCKETS_PER_IP = 10;
const activeSocketsByIp = new Map<string, number>();

const io = new Server(httpServer, {
  cors: {
    origin: clientOrigins.length > 0 ? clientOrigins : true,
    methods: ["GET", "POST"]
  },
  allowRequest: (request, callback) => {
    if (!isAllowedRequestOrigin(request)) {
      callback("허용되지 않은 출처입니다.", false);
      return;
    }

    if (!rateLimitsDisabled && (activeSocketsByIp.get(clientIp(request)) ?? 0) >= MAX_SOCKETS_PER_IP) {
      callback("IP당 동시에 최대 10개까지 연결할 수 있습니다.", false);
      return;
    }

    callback(null, true);
  },
  maxHttpBufferSize: 16_384,
  pingTimeout: 20_000,
  pingInterval: 25_000
});

const engine = new GameEngine(io);

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "요청을 처리하지 못했습니다";

const respond = (socket: GameSocket, ack: Ack | undefined, action: () => Record<string, unknown>): void => {
  try {
    const response = action();
    ack?.(response);
  } catch (error) {
    const message = errorMessage(error);
    socket.emit("error", { message });
    ack?.({ error: message });
  }
};

const perform = (socket: GameSocket, ack: Ack | undefined, action: () => void): void => {
  try {
    action();
    ack?.({ ok: true });
  } catch (error) {
    const message = errorMessage(error);
    socket.emit("error", { message });
    ack?.({ ok: false, error: message });
  }
};

type RateLimitName = "room:create" | "room:access" | "chat:send";

interface RateLimitPolicy {
  limit: number;
  windowMs: number;
  message: (retryAfterSeconds: number) => string;
}

interface RateLimitBucket {
  timestamps: number[];
  lastSeenAt: number;
  windowMs: number;
}

const rateLimitPolicies: Record<RateLimitName, RateLimitPolicy> = {
  "room:create": {
    limit: 3,
    windowMs: 10 * 60_000,
    message: (seconds) => `방 만들기 요청이 너무 많습니다. ${seconds}초 후 다시 시도해 주세요.`
  },
  "room:access": {
    limit: 20,
    windowMs: 60_000,
    message: (seconds) => `방 참가 요청이 너무 많습니다. ${seconds}초 후 다시 시도해 주세요.`
  },
  "chat:send": {
    limit: 5,
    windowMs: 10_000,
    message: (seconds) => `채팅을 너무 빠르게 보내고 있습니다. ${seconds}초 후 다시 시도해 주세요.`
  }
};

const MAX_RATE_LIMIT_BUCKETS = 10_000;
const rateLimitBuckets = new Map<string, RateLimitBucket>();

const cleanRateLimitBuckets = (now = Date.now()): void => {
  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.lastSeenAt + bucket.windowMs <= now) rateLimitBuckets.delete(key);
  }
};

const makeRoomForRateLimitBucket = (now: number): void => {
  if (rateLimitBuckets.size < MAX_RATE_LIMIT_BUCKETS) return;
  cleanRateLimitBuckets(now);
  if (rateLimitBuckets.size < MAX_RATE_LIMIT_BUCKETS) return;

  const oldestKey = rateLimitBuckets.keys().next().value as string | undefined;
  if (oldestKey) rateLimitBuckets.delete(oldestKey);
};

const consumeRateLimit = (identity: string, name: RateLimitName): void => {
  if (rateLimitsDisabled) return;

  const now = Date.now();
  const policy = rateLimitPolicies[name];
  const key = `${name}:${identity}`;
  const existing = rateLimitBuckets.get(key);
  const timestamps = (existing?.timestamps ?? []).filter((timestamp) => timestamp > now - policy.windowMs);

  if (timestamps.length >= policy.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil(((timestamps[0] ?? now) + policy.windowMs - now) / 1_000));
    if (existing) existing.lastSeenAt = now;
    throw new Error(policy.message(retryAfterSeconds));
  }

  if (!existing) makeRoomForRateLimitBucket(now);
  timestamps.push(now);
  rateLimitBuckets.set(key, { timestamps, lastSeenAt: now, windowMs: policy.windowMs });
};

const rateLimitCleanupTimer = setInterval(cleanRateLimitBuckets, 60_000);
rateLimitCleanupTimer.unref();

io.on("connection", (socket: GameSocket) => {
  const ip = clientIp(socket.request);
  const activeSocketCount = activeSocketsByIp.get(ip) ?? 0;
  if (!rateLimitsDisabled && activeSocketCount >= MAX_SOCKETS_PER_IP) {
    socket.emit("error", { message: "IP당 동시에 최대 10개까지 연결할 수 있습니다." });
    socket.disconnect(true);
    return;
  }
  activeSocketsByIp.set(ip, activeSocketCount + 1);

  socket.once("disconnect", () => {
    const remaining = (activeSocketsByIp.get(ip) ?? 1) - 1;
    if (remaining > 0) activeSocketsByIp.set(ip, remaining);
    else activeSocketsByIp.delete(ip);
  });

  socket.on("room:create", (payload: { nickname?: unknown } = {}, ack?: Ack) => {
    respond(socket, ack, () => {
      consumeRateLimit(ip, "room:create");
      return engine.createRoom(socket, payload.nickname);
    });
  });

  socket.on("room:join", (payload: { code?: unknown; nickname?: unknown } = {}, ack?: Ack) => {
    respond(socket, ack, () => {
      consumeRateLimit(ip, "room:access");
      return engine.joinRoom(socket, payload.code, payload.nickname);
    });
  });

  socket.on("room:rejoin", (payload: { playerId?: unknown; code?: unknown } = {}, ack?: Ack) => {
    respond(socket, ack, () => {
      consumeRateLimit(ip, "room:access");
      return engine.rejoinRoom(socket, payload.playerId, payload.code);
    });
  });

  socket.on(
    "room:start",
    (payload: { aiCount?: unknown; rounds?: unknown; spectatorMode?: unknown; difficulty?: unknown } = {}, ack?: Ack) => {
      perform(socket, ack, () => engine.startGame(socket, payload));
    }
  );

  socket.on("chat:send", (payload: { text?: unknown } = {}, ack?: Ack) => {
    perform(socket, ack, () => {
      // 행사장/학교 Wi-Fi에서는 많은 참가자가 한 공인 IP를 공유한다.
      // 방 접근 방어는 IP 기준을 유지하되 채팅 속도는 참가자 연결별로 격리한다.
      consumeRateLimit(socket.data.playerId ?? socket.id, "chat:send");
      engine.sendChat(socket, payload.text);
    });
  });

  socket.on("vote:cast", (payload: { targetAnonName?: unknown } = {}, ack?: Ack) => {
    perform(socket, ack, () => engine.castVote(socket, payload.targetAnonName));
  });

  socket.on("interrogation:use", (payload: { targetAnonName?: unknown } = {}, ack?: Ack) => {
    perform(socket, ack, () => engine.useInterrogation(socket, payload.targetAnonName));
  });

  socket.on("spectator:bet", (payload: { targetAnonName?: unknown } = {}, ack?: Ack) => {
    respond(socket, ack, () => engine.placeSpectatorBet(socket, payload.targetAnonName));
  });

  socket.on("room:again", (_payload: unknown = {}, ack?: Ack) => {
    perform(socket, ack, () => engine.again(socket));
  });

  socket.on("disconnect", () => engine.disconnect(socket));
});

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
httpServer.listen(Number.isFinite(port) ? port : 3000, "0.0.0.0", () => {
  console.log(`인간을 찾아라 server listening on :${Number.isFinite(port) ? port : 3000}`);
  const ai = getAiRuntimeStatus();
  console.log(ai.mode === "luna" ? `OpenAI model: ${ai.model}` : "AI mode: mock");
});

const shutdown = (): void => {
  clearInterval(rateLimitCleanupTimer);
  io.close(() => {
    httpServer.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 5_000).unref();
};

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
