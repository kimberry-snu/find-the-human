import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import { REPOSITORY_ROOT } from "./env.js";
import { GameEngine } from "./game.js";
import type { Ack, GameSocket } from "./types.js";

const app = express();
app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "32kb" }));

app.get("/health", (_request, response) => {
  response.status(200).json({ ok: true });
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
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_ORIGIN?.split(",").map((origin) => origin.trim()).filter(Boolean) || true,
    methods: ["GET", "POST"]
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

io.on("connection", (socket: GameSocket) => {
  socket.on("room:create", (payload: { nickname?: unknown } = {}, ack?: Ack) => {
    respond(socket, ack, () => engine.createRoom(socket, payload.nickname));
  });

  socket.on("room:join", (payload: { code?: unknown; nickname?: unknown } = {}, ack?: Ack) => {
    respond(socket, ack, () => engine.joinRoom(socket, payload.code, payload.nickname));
  });

  socket.on("room:rejoin", (payload: { playerId?: unknown; code?: unknown } = {}, ack?: Ack) => {
    respond(socket, ack, () => engine.rejoinRoom(socket, payload.playerId, payload.code));
  });

  socket.on(
    "room:start",
    (payload: { aiCount?: unknown; rounds?: unknown; spectatorMode?: unknown } = {}, ack?: Ack) => {
      perform(socket, ack, () => engine.startGame(socket, payload));
    }
  );

  socket.on("chat:send", (payload: { text?: unknown } = {}, ack?: Ack) => {
    perform(socket, ack, () => engine.sendChat(socket, payload.text));
  });

  socket.on("vote:cast", (payload: { targetAnonName?: unknown } = {}, ack?: Ack) => {
    perform(socket, ack, () => engine.castVote(socket, payload.targetAnonName));
  });

  socket.on("room:again", (_payload: unknown = {}, ack?: Ack) => {
    perform(socket, ack, () => engine.again(socket));
  });

  socket.on("disconnect", () => engine.disconnect(socket));
});

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
httpServer.listen(Number.isFinite(port) ? port : 3000, "0.0.0.0", () => {
  console.log(`인간을 찾아라 server listening on :${Number.isFinite(port) ? port : 3000}`);
  console.log(process.env.OPENAI_API_KEY ? `OpenAI model: ${process.env.OPENAI_MODEL || "gpt-4o-mini"}` : "AI mode: mock");
});

const shutdown = (): void => {
  io.close(() => {
    httpServer.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 5_000).unref();
};

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
