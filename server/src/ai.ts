import { CHAT_SYSTEM_PROMPT, MOCK_LINES, MOCK_REASONS } from "./content.js";
import type { Participant, Room } from "./types.js";
import { pick, sleep, truncateCodePoints } from "./utils.js";

export type ChatTrigger = "natural" | "question" | "mentioned" | "interrogated" | "defense";

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

const model = (): string => process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
const temperature = (): number => model().startsWith("gpt-5.6") ? 1 : 1.1;

const promptFor = (participant: Participant): string => {
  const persona = participant.persona;
  if (!persona) return CHAT_SYSTEM_PROMPT;
  return CHAT_SYSTEM_PROMPT
    .replaceAll("{anonName}", participant.anonName)
    .replaceAll("{age}", String(persona.age))
    .replaceAll("{job}", persona.job)
    .replaceAll("{tone}", persona.tone)
    .replaceAll("{interests}", persona.interests)
    .replaceAll("{quirk}", persona.quirk);
};

const triggerText = (trigger: ChatTrigger): string => {
  if (trigger === "question") return "질문 카드에 아직 답 안 했다. 지금 답해라";
  if (trigger === "mentioned") return "방금 네가 지목당했다. 반응해라";
  if (trigger === "interrogated") return "방금 심문당했다. 질문에 피하지 말고 짧은 반말 한 문장으로 바로 답해라";
  if (trigger === "defense") return "네가 최다 득표자가 됐다. 억울함과 다른 참가자에 대한 역의심을 담아 짧은 반말 한 문장으로 최후 변론해라";
  return "지금 자연스럽게 끼어들어 한마디 해라";
};

const recentLog = (room: Room): string =>
  room.chats.slice(-30).map((entry) => `[${entry.from}] ${entry.text}`).join("\n") || "(아직 대화 없음)";

const requestOpenAI = async (
  body: Record<string, unknown>,
  deadline?: number
): Promise<string> => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const remaining = deadline === undefined ? 15_000 : deadline - Date.now();
      if (remaining <= 0) throw new Error("OpenAI phase deadline exceeded");
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.max(1, Math.min(15_000, remaining)))
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`OpenAI ${response.status}: ${detail.slice(0, 240)}`);
      }
      const parsed = (await response.json()) as ChatCompletionResponse;
      const content = parsed.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("OpenAI returned empty content");
      return content;
    } catch (error) {
      lastError = error;
      if (deadline !== undefined && Date.now() >= deadline) break;
      if (attempt < 2 && (deadline === undefined || Date.now() < deadline)) {
        await sleep(150 * (attempt + 1));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("OpenAI request failed");
};

export const mockQuestionAnswer = (participant: Participant, questionCard?: string): string => {
  const persona = participant.persona;
  if (!persona) return pick(MOCK_LINES);
  const interest = persona.interests.split(",")[0]?.trim() || "유튜브";
  const job = persona.job.split(",")[0]?.trim() || "친구";
  const card = questionCard ?? "";
  let answer: string;
  if (card.includes("저녁")) answer = "김치찌개 먹음ㅋㅋ";
  else if (card.includes("배터리")) answer = `${31 + (persona.age % 37)}퍼 남음`;
  else if (card.includes("드라마") || card.includes("영화")) answer = "어제 파묘 다시봄";
  else if (card.includes("아침") || card.includes("일어났")) answer = `${7 + (persona.age % 4)}시쯤 일어남`;
  else if (card.includes("창밖")) answer = "아파트랑 차만보임";
  else if (card.includes("후회")) answer = "운동화 산거 좀후회";
  else if (card.includes("MBTI")) answer = ["INFP", "ISTP", "ENFP", "INTJ"][persona.age % 4] as string;
  else if (card.includes("노래")) answer = "요즘 데이식스ㅋㅋ";
  else if (card.includes("양말")) answer = "검정인데 짝짝이임";
  else if (card.includes("카톡")) answer = `${job} 단톡방`;
  else if (card.includes("스트레스")) answer = `${interest} 하면서 품`;
  else if (card.includes("잔고")) answer = `${persona.age * 3}만원쯤;;`;
  else if (card.includes("냉장고")) answer = "계란이랑 맥주있음";
  else if (card.includes("검색")) answer = `${interest} 검색함`;
  else if (card.includes("배달앱")) answer = "마라탕 시킨게 끝";
  else if (card.includes("가까운 물건")) answer = "식은 커피 바로옆";
  else if (card.includes("잠들")) answer = "두시반쯤 잔듯";
  else if (card.includes("사진")) answer = "고양이 사진ㅋㅋ";
  else if (card.includes("편의점")) answer = "제로콜라 먼저집음";
  else if (card.includes("오래 얘기")) answer = `${job} 사람이랑`;
  else answer = `${interest} 생각중ㅋㅋ`;
  return truncateCodePoints(answer, 24);
};

const cleanChatOutput = (raw: string): string[] => {
  const withoutLabel = raw
    .replace(/^```(?:text)?/i, "")
    .replace(/```$/i, "")
    .replace(/^['\"“”]|['\"“”]$/g, "")
    .trim();
  const lines = withoutLabel
    .split(/\r?\n+/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 2);
  return lines.length > 0 ? lines : [pick(MOCK_LINES)];
};

export const generateAiChat = async (
  participant: Participant,
  room: Room,
  trigger: ChatTrigger,
  deadline = room.phaseEndsAt
): Promise<string[]> => {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    if (trigger === "interrogated") {
      return [pick(["뭘 또 증명해ㅋㅋ", "방금 말했잖아;;", "나보다 너가 더 수상함", "진짜 사람인데 억울하네"])];
    }
    if (trigger === "defense") {
      return [pick(["나 뽑으면 진짜 후회함ㅋㅋ", "억울해 쟤가 더 수상해", "이걸 속네 다들;;", "잠깐 나 진짜 사람임"])];
    }
    const first = trigger === "question" ? mockQuestionAnswer(participant, room.questionCard) : pick(MOCK_LINES);
    return Math.random() < 0.3 ? [first, pick(MOCK_LINES)] : [first];
  }

  try {
    const questionContext = room.questionCard ? `\n이번 질문 카드: ${room.questionCard}` : "";
    const interrogationContext = trigger === "interrogated" && room.interrogation
      ? `\n심문 질문: ${room.interrogation.question}`
      : "";
    const output = await requestOpenAI({
      model: model(),
      temperature: temperature(),
      max_completion_tokens: 60,
      messages: [
        { role: "system", content: promptFor(participant) },
        {
          role: "user",
          content: `${recentLog(room)}${questionContext}${interrogationContext}\n\n${triggerText(trigger)}`
        }
      ]
    }, deadline);
    return cleanChatOutput(output);
  } catch (error) {
    console.warn(`[AI chat fallback] ${error instanceof Error ? error.message : String(error)}`);
    if (trigger === "interrogated") return ["갑자기 그걸 왜물어ㅋㅋ"];
    if (trigger === "defense") return ["나 아니라고 진짜 억울함;;"];
    return [trigger === "question" ? mockQuestionAnswer(participant, room.questionCard) : pick(MOCK_LINES)];
  }
};

const parseVote = (raw: string): { target?: unknown; reason?: unknown } | undefined => {
  try {
    return JSON.parse(raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim()) as {
      target?: unknown;
      reason?: unknown;
    };
  } catch {
    return undefined;
  }
};

export const generateAiVote = async (
  participant: Participant,
  room: Room,
  candidates: string[]
): Promise<{ target: string; reason: string }> => {
  const fallback = (): { target: string; reason: string } => ({
    target: pick(candidates),
    reason: pick(MOCK_REASONS)
  });

  if (candidates.length === 0) throw new Error("AI has no valid vote target");
  if (!process.env.OPENAI_API_KEY?.trim()) return fallback();

  const votePrompt = `아래는 이번 라운드 채팅 로그다. 너는 ${participant.anonName}이다.
인간으로 가장 의심되는 생존자 1명을 지목하라. 자기 자신은 지목 불가.
생존자 목록: ${candidates.join(", ")}
단서 예시: 너무 정중함, 너무 논리적임, 발화가 지나치게 적음, AI 흉내가 어색함, 반응이 부자연스러움.
확신이 없으면 이번 라운드에 제일 시끄럽게 떠든 참가자를 지목해라.
출력: {"target": "<생존자 익명닉>", "reason": "<25자 이내 한 줄, 반말>"}

${recentLog(room)}`;

  // 유효하지 않은 target이면 스펙대로 한 번 더 전체 호출한다.
  for (let validationAttempt = 0; validationAttempt < 2; validationAttempt += 1) {
    try {
      const output = await requestOpenAI({
        model: model(),
        temperature: temperature(),
        max_completion_tokens: 60,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "human_suspicion_vote",
            strict: true,
            schema: {
              type: "object",
              properties: {
                target: { type: "string", enum: candidates },
                reason: { type: "string", maxLength: 25 }
              },
              required: ["target", "reason"],
              additionalProperties: false
            }
          }
        },
        messages: [{ role: "user", content: votePrompt }]
      }, room.phaseEndsAt);
      const parsed = parseVote(output);
      if (typeof parsed?.target !== "string" || !candidates.includes(parsed.target)) continue;
      const reason = typeof parsed.reason === "string" && parsed.reason.trim()
        ? truncateCodePoints(parsed.reason.trim(), 25)
        : pick(MOCK_REASONS);
      return { target: parsed.target, reason };
    } catch (error) {
      console.warn(`[AI vote retry] ${error instanceof Error ? error.message : String(error)}`);
      return fallback();
    }
  }

  return fallback();
};
