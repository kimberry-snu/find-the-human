import { useId, useState, type FormEvent } from 'react';
import { sanitizeRoomCode } from '../lib/game-utils';
import { ArrowIcon, UsersIcon } from './icons';
import { BrandMark } from './BrandMark';

interface HomeScreenProps {
  connected: boolean;
  connecting: boolean;
  busy: boolean;
  onCreate: (nickname: string) => Promise<void>;
  onJoin: (nickname: string, code: string) => Promise<void>;
}

export function HomeScreen({
  connected,
  connecting,
  busy,
  onCreate,
  onJoin,
}: HomeScreenProps) {
  const nicknameId = useId();
  const codeId = useId();
  const [nickname, setNickname] = useState('');
  const [code, setCode] = useState('');
  const unavailable = busy || !connected;

  const handleJoin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (code.length !== 4 || !nickname.trim()) return;
    void onJoin(nickname, code);
  };

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(24px,env(safe-area-inset-top))]">
      <div className="pointer-events-none absolute -right-32 -top-32 h-80 w-80 rounded-full bg-signal/[0.08] blur-3xl" />
      <div className="pointer-events-none absolute -left-32 top-1/3 h-72 w-72 rounded-full bg-electric/[0.07] blur-3xl" />

      <header className="relative flex items-center justify-between">
        <BrandMark />
        <div className="flex items-center gap-2 text-[11px] font-bold text-white/45">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              connected ? 'bg-emerald-300 shadow-[0_0_10px_#6ee7b7]' : 'animate-pulse bg-amber-300'
            }`}
          />
          {connected ? 'LIVE' : connecting ? '연결 중' : '재연결 중'}
        </div>
      </header>

      <section className="relative mt-auto pt-12 sm:pt-20">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-electric/15 bg-electric/[0.06] px-3 py-1.5 text-[11px] font-bold text-electric-soft">
          <span aria-hidden="true">✦</span>
          AI 사이에 인간이 숨어 있다
        </div>
        <h1 className="max-w-[330px] text-[42px] font-black leading-[1.04] tracking-[-0.065em] text-white sm:text-5xl">
          사람처럼 말고,
          <br />
          <span className="text-white/30">AI처럼 살아남아.</span>
        </h1>
        <p className="mt-5 max-w-[330px] text-[13px] font-medium leading-6 text-white/45">
          익명 채팅 속 진짜 인간을 지목하는 역튜링 심리전.
          <br />
          정체를 숨기고 AI들의 의심을 피하세요.
        </p>
      </section>

      <section className="relative mt-9 rounded-[28px] border border-white/[0.08] bg-white/[0.035] p-4 shadow-2xl backdrop-blur-xl">
        <label htmlFor={nicknameId} className="mb-2 block text-[11px] font-bold text-white/45">
          게임에서 사용할 닉네임
        </label>
        <input
          id={nicknameId}
          value={nickname}
          onChange={(event) => setNickname(event.target.value.slice(0, 16))}
          maxLength={16}
          autoComplete="nickname"
          enterKeyHint="next"
          placeholder="닉네임 입력"
          className="h-[52px] w-full rounded-2xl border border-white/10 bg-black/25 px-4 text-[15px] font-bold text-white outline-none transition placeholder:text-white/20 focus:border-electric/40 focus:ring-4 focus:ring-electric/[0.06]"
        />

        <button
          type="button"
          onClick={() => void onCreate(nickname)}
          disabled={unavailable || !nickname.trim()}
          className="mt-3 flex h-[52px] w-full items-center justify-between rounded-2xl bg-white px-4 text-sm font-black text-black transition hover:bg-electric-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 disabled:cursor-not-allowed disabled:opacity-35"
        >
          <span className="flex items-center gap-2.5">
            <UsersIcon className="h-5 w-5" />새 방 만들기
          </span>
          <ArrowIcon className="h-5 w-5" />
        </button>

        <div className="my-4 flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-white/[0.07]" />
          <span className="text-[10px] font-bold text-white/20">또는 초대받기</span>
          <span className="h-px flex-1 bg-white/[0.07]" />
        </div>

        <form onSubmit={handleJoin} className="flex gap-2">
          <label htmlFor={codeId} className="sr-only">
            4자리 초대코드
          </label>
          <input
            id={codeId}
            value={code}
            onChange={(event) => setCode(sanitizeRoomCode(event.target.value))}
            maxLength={4}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            placeholder="초대코드"
            className="h-12 min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/25 px-4 text-center font-mono text-base font-black uppercase tracking-[0.25em] text-white outline-none transition placeholder:font-sans placeholder:text-xs placeholder:tracking-normal placeholder:text-white/20 focus:border-electric/40"
          />
          <button
            type="submit"
            disabled={unavailable || !nickname.trim() || code.length !== 4}
            className="h-12 shrink-0 rounded-2xl border border-white/10 bg-white/[0.07] px-4 text-xs font-black text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric disabled:cursor-not-allowed disabled:opacity-30"
          >
            참가하기
          </button>
        </form>
      </section>

      <p className="relative mt-auto pt-6 text-center text-[10px] font-medium text-white/20">
        대화 속 누구도 믿지 마세요 · 140자 익명 채팅
      </p>
    </main>
  );
}
