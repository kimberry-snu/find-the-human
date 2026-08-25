import { useEffect, useState, type FormEvent } from 'react';
import { formatClock } from '../lib/game-utils';
import { useCountdown } from '../hooks/useCountdown';
import type { ChatMessage } from '../types';
import { BrandMark } from './BrandMark';
import { SendIcon } from './icons';

interface DefenseScreenProps {
  defenseTarget: string | null;
  endsAt: number | null;
  yourAnonName: string | null;
  isSpectator: boolean;
  connected: boolean;
  messages: ChatMessage[];
  defenseMessageSent: boolean;
  onSend: (text: string) => Promise<void>;
}

function latestDefenseMessage(
  messages: ChatMessage[],
  target: string | null,
  endsAt: number | null,
): ChatMessage | null {
  if (!target) return null;
  const phaseStartedAt = endsAt === null ? 0 : endsAt - 16_000;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.from === target && message.ts >= phaseStartedAt) return message;
  }
  return null;
}

export function DefenseScreen({
  defenseTarget,
  endsAt,
  yourAnonName,
  isSpectator,
  connected,
  messages,
  defenseMessageSent,
  onSend,
}: DefenseScreenProps) {
  const [draft, setDraft] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const remainingMs = useCountdown(endsAt);
  const isDefendant =
    Boolean(defenseTarget) && defenseTarget === yourAnonName && !isSpectator;
  const hasSubmitted = submitted || defenseMessageSent;
  const canSubmit = isDefendant && connected && !hasSubmitted && !isSending && remainingMs > 0;
  const defenseMessage = latestDefenseMessage(messages, defenseTarget, endsAt);

  useEffect(() => {
    setDraft('');
    setSubmitted(false);
    setIsSending(false);
  }, [defenseTarget, endsAt]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const answer = draft.trim();
    if (!canSubmit || !answer) return;
    setIsSending(true);
    try {
      await onSend(answer);
      setSubmitted(true);
      setDraft('');
    } catch {
      // The shared socket notice explains the rejection and keeps the form open.
    } finally {
      setIsSending(false);
    }
  };

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(18px,env(safe-area-inset-top))]">
      <div className="pointer-events-none absolute -left-32 top-24 h-80 w-80 animate-defense-glow rounded-full bg-signal/[0.16] blur-3xl" />
      <div className="pointer-events-none absolute -right-32 bottom-20 h-72 w-72 rounded-full bg-amber-300/[0.08] blur-3xl" />

      <header className="relative flex items-center justify-between">
        <BrandMark compact />
        <span
          className={`rounded-xl border px-3 py-2 font-mono text-lg font-black ${
            remainingMs <= 5_000
              ? 'animate-urgent border-signal/35 bg-signal/15 text-signal-soft'
              : 'border-amber-300/20 bg-amber-300/[0.07] text-amber-100'
          }`}
          aria-label={`최후 변론 남은 시간 ${formatClock(remainingMs)}`}
        >
          {formatClock(remainingMs)}
        </span>
      </header>

      <section className="relative my-auto py-8 text-center" aria-live="polite">
        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-signal-soft/70">
          Final defense
        </p>
        <span className="mx-auto mt-6 grid h-24 w-24 animate-result-pop place-items-center rounded-[32px] border border-signal/25 bg-signal/[0.11] text-5xl shadow-signal" aria-hidden="true">
          📢
        </span>
        <h1 className="mt-6 text-[32px] font-black leading-tight tracking-[-0.05em] text-white">
          최후의 변론
        </h1>
        <p className="mt-3 text-xs font-medium leading-5 text-white/38">
          최다 득표자에게 마지막 15초가 주어졌습니다.
        </p>

        <article className={`mx-auto mt-7 max-w-sm rounded-[28px] border p-5 ${
          isDefendant
            ? 'animate-interrogation border-signal/40 bg-signal/[0.1]'
            : 'border-white/10 bg-white/[0.045]'
        }`}>
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30">Most suspected</p>
          <p className="mt-2 break-keep text-2xl font-black text-white">{defenseTarget ?? '집계 중…'}</p>
          <p className={`mt-2 text-[11px] font-bold ${isDefendant ? 'text-signal-soft' : 'text-white/30'}`}>
            {isDefendant ? '당신입니다. 한 문장으로 모두를 설득하세요!' : '마지막 말을 지켜보세요.'}
          </p>
          {defenseMessage ? (
            <blockquote className="mt-4 animate-message-in rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left text-sm font-extrabold leading-6 text-white/85">
              “{defenseMessage.text}”
            </blockquote>
          ) : null}
        </article>
      </section>

      <footer className="relative">
        {isDefendant ? (
          hasSubmitted ? (
            <div className="grid min-h-[104px] place-items-center rounded-2xl border border-electric/15 bg-electric/[0.055] px-4 text-center" role="status">
              <div>
                <p className="text-sm font-black text-electric-soft">✓ 최후 변론을 보냈어요</p>
                <p className="mt-1 text-[10px] font-semibold text-white/30">이제 운명은 투표 결과에 달렸습니다.</p>
              </div>
            </div>
          ) : (
            <form
              onSubmit={submit}
              className="rounded-3xl border border-signal/20 bg-ink-900/90 p-3 shadow-2xl backdrop-blur-xl"
              aria-busy={isSending}
            >
              <label htmlFor="defense-composer" className="mb-2 block text-[10px] font-black text-signal-soft/75">
                마지막 한마디 · 제출 후 수정할 수 없어요
              </label>
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1 rounded-2xl border border-signal/25 bg-black/25 px-3.5 py-2 focus-within:ring-4 focus-within:ring-signal/[0.08]">
                  <textarea
                    id="defense-composer"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value.slice(0, 140))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    rows={2}
                    maxLength={140}
                    autoFocus
                    enterKeyHint="send"
                    placeholder="내가 인간이라고? 오히려 너희 반응이 더 수상한데…"
                    disabled={!canSubmit}
                    className="max-h-24 min-h-10 w-full resize-none bg-transparent text-[13px] font-semibold leading-5 text-white outline-none placeholder:text-white/20 disabled:opacity-45"
                  />
                  <p className="text-right text-[9px] font-bold text-white/20">{draft.length}/140</p>
                </div>
                <button
                  type="submit"
                  disabled={!canSubmit || !draft.trim()}
                  className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-signal text-white transition hover:bg-signal-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label="최후 변론 보내기"
                >
                  <SendIcon className="h-5 w-5" />
                </button>
              </div>
            </form>
          )
        ) : (
          <div className="flex min-h-[74px] items-center justify-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.035] text-xs font-black text-white/40">
            <span className="inline-flex gap-1" aria-hidden="true">
              <i className="typing-dot" />
              <i className="typing-dot [animation-delay:150ms]" />
              <i className="typing-dot [animation-delay:300ms]" />
            </span>
            {defenseMessage
              ? '마지막 말이 끝났어요 · 결과를 집계하는 중'
              : `${defenseTarget ?? '최다 득표자'}의 마지막 말을 기다리는 중`}
          </div>
        )}
      </footer>
    </main>
  );
}
