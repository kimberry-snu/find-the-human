import { useRef, useState } from 'react';
import { normalizeWinner } from '../lib/game-utils';
import type { GameResult, Notice } from '../types';
import { BrandMark } from './BrandMark';
import { CopyIcon, RefreshIcon } from './icons';

interface ResultScreenProps {
  result: GameResult;
  spectatorMode: boolean;
  roomCode: string | null;
  isHost: boolean;
  onAgain: () => void;
  onNotify: (message: string, tone?: Notice['tone']) => void;
}

const AWARD_EMOJI: Record<string, string> = {
  humanlike_ai: '🎭',
  most_suspected_human: '💥',
  detective: '🕵️',
};

interface ResultCardData {
  headline: string;
  headlineEmoji: string;
  humanCount: number;
  aiCount: number;
  awards: GameResult['awards'];
  roomCode: string | null;
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (context.measureText(text).width <= maxWidth) return text;

  const characters = Array.from(text);
  while (characters.length && context.measureText(`${characters.join('')}…`).width > maxWidth) {
    characters.pop();
  }
  return `${characters.join('').trimEnd()}…`;
}

function createResultCardBlob({
  headline,
  headlineEmoji,
  humanCount,
  aiCount,
  awards,
  roomCode,
}: ResultCardData) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const context = canvas.getContext('2d');

  if (!context) throw new Error('결과 카드를 그릴 수 없어요.');

  const background = context.createLinearGradient(0, 0, 1080, 1350);
  background.addColorStop(0, '#111329');
  background.addColorStop(0.55, '#080a18');
  background.addColorStop(1, '#121023');
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const cyanGlow = context.createRadialGradient(100, 180, 0, 100, 180, 520);
  cyanGlow.addColorStop(0, 'rgba(87, 245, 255, 0.22)');
  cyanGlow.addColorStop(1, 'rgba(87, 245, 255, 0)');
  context.fillStyle = cyanGlow;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const violetGlow = context.createRadialGradient(1050, 1100, 0, 1050, 1100, 600);
  violetGlow.addColorStop(0, 'rgba(168, 139, 250, 0.23)');
  violetGlow.addColorStop(1, 'rgba(168, 139, 250, 0)');
  context.fillStyle = violetGlow;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.textBaseline = 'alphabetic';
  context.fillStyle = '#64f7ff';
  context.font = '900 26px system-ui, -apple-system, "Segoe UI", sans-serif';
  context.letterSpacing = '5px';
  context.fillText('REVERSE TURING PARTY GAME', 80, 105);
  context.letterSpacing = '0px';

  context.fillStyle = '#ffffff';
  context.font = '900 54px system-ui, -apple-system, "Segoe UI", sans-serif';
  context.fillText('인간을 찾아라', 80, 178);

  roundedRectPath(context, 80, 248, 920, 380, 48);
  const hero = context.createLinearGradient(80, 248, 1000, 628);
  hero.addColorStop(0, 'rgba(87, 245, 255, 0.14)');
  hero.addColorStop(1, 'rgba(168, 139, 250, 0.13)');
  context.fillStyle = hero;
  context.fill();
  context.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  context.lineWidth = 2;
  context.stroke();

  context.textAlign = 'center';
  context.font = '92px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  context.fillStyle = '#ffffff';
  context.fillText(headlineEmoji, 540, 395);
  context.font = '900 68px system-ui, -apple-system, "Segoe UI", sans-serif';
  context.fillText(fitText(context, headline, 800), 540, 520);
  context.fillStyle = 'rgba(255, 255, 255, 0.48)';
  context.font = '700 27px system-ui, -apple-system, "Segoe UI", sans-serif';
  context.fillText('당신의 역튜링 테스트 결과', 540, 572);
  context.textAlign = 'left';

  const drawStat = (x: number, label: string, count: number, color: string) => {
    roundedRectPath(context, x, 674, 440, 190, 36);
    context.fillStyle = 'rgba(255, 255, 255, 0.055)';
    context.fill();
    context.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = color;
    context.font = '900 26px ui-monospace, "SFMono-Regular", Consolas, monospace';
    context.fillText(label, x + 34, 730);
    context.fillStyle = '#ffffff';
    context.font = '900 76px system-ui, -apple-system, "Segoe UI", sans-serif';
    context.fillText(String(count), x + 34, 825);
  };

  drawStat(80, 'HUMAN', humanCount, '#64f7ff');
  drawStat(560, 'AI', aiCount, '#c4b5fd');

  const topAwards = awards.slice(0, 2);
  if (topAwards.length) {
    context.fillStyle = 'rgba(255, 255, 255, 0.45)';
    context.font = '900 22px system-ui, -apple-system, "Segoe UI", sans-serif';
    context.fillText('TODAY\'S TITLES', 80, 930);

    topAwards.forEach((award, index) => {
      const y = 964 + index * 112;
      roundedRectPath(context, 80, y, 920, 90, 26);
      context.fillStyle = 'rgba(251, 191, 36, 0.075)';
      context.fill();
      context.strokeStyle = 'rgba(253, 230, 138, 0.13)';
      context.stroke();
      context.font = '38px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
      context.fillStyle = '#ffffff';
      context.fillText(AWARD_EMOJI[award.id] ?? '✦', 110, y + 59);
      context.font = '900 25px system-ui, -apple-system, "Segoe UI", sans-serif';
      context.fillStyle = '#fde68a';
      context.fillText(fitText(context, award.title, 310), 168, y + 39);
      context.font = '800 27px system-ui, -apple-system, "Segoe UI", sans-serif';
      context.fillStyle = '#ffffff';
      context.fillText(fitText(context, award.recipient, 610), 168, y + 70);
    });
  }

  context.fillStyle = 'rgba(255, 255, 255, 0.24)';
  context.font = '800 23px system-ui, -apple-system, "Segoe UI", sans-serif';
  context.fillText(roomCode ? `ROOM  ${roomCode}` : 'FIND THE HUMAN', 80, 1271);
  context.textAlign = 'right';
  context.fillStyle = 'rgba(100, 247, 255, 0.65)';
  context.fillText('#인간을찾아라', 1000, 1271);

  // Keep PNG encoding synchronous so mobile browsers still consider the native
  // share call part of the original button gesture.
  const encodedPng = canvas.toDataURL('image/png').split(',')[1];
  if (!encodedPng) throw new Error('결과 카드 이미지를 만들지 못했어요.');
  const binaryPng = window.atob(encodedPng);
  const bytes = new Uint8Array(binaryPng.length);
  for (let index = 0; index < binaryPng.length; index += 1) {
    bytes[index] = binaryPng.charCodeAt(index);
  }
  return new Blob([bytes], { type: 'image/png' });
}

function isShareAbort(error: unknown) {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

function downloadResultCard(blob: Blob, roomCode: string | null) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const suffix = roomCode ? `-${roomCode.toLowerCase()}` : '';
  link.href = objectUrl;
  link.download = `find-the-human-result${suffix}.png`;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

async function copyResultText(text: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false;
  let timeoutId: number | undefined;
  try {
    await Promise.race([
      navigator.clipboard.writeText(text),
      new Promise<never>((_resolve, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error('clipboard timeout')),
          1_500,
        );
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

export function ResultScreen({
  result,
  spectatorMode,
  roomCode,
  isHost,
  onAgain,
  onNotify,
}: ResultScreenProps) {
  const [isSharing, setIsSharing] = useState(false);
  const shareInFlight = useRef(false);
  const winner = spectatorMode ? 'SPECTATOR' : normalizeWinner(result.winner);
  const humanCount = result.reveal.filter((identity) => !identity.isAI).length;
  const aiCount = result.reveal.length - humanCount;

  const headline =
    winner === 'AI'
      ? { eyebrow: 'AI victory', title: 'AI가 인간을 찾아냈다', emoji: '🤖', color: 'text-violet-200' }
      : winner === 'HUMAN'
        ? { eyebrow: 'Human survived', title: '인간이 끝까지 살아남았다', emoji: '🧑', color: 'text-electric' }
        : { eyebrow: 'Spectator mode', title: '놀랍게도 전원 AI였다', emoji: '👁', color: 'text-white' };

  const shareText = [
    `🎭 인간을 찾아라 · ${headline.title}`,
    `인간 ${humanCount}명 vs AI ${aiCount}명`,
    ...result.awards.slice(0, 2).map((award) => `${AWARD_EMOJI[award.id] ?? '✦'} ${award.title}: ${award.recipient}`),
    roomCode ? `초대코드 ${roomCode}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const shareResult = async () => {
    if (shareInFlight.current) return;
    shareInFlight.current = true;
    setIsSharing(true);

    const url = new URL(window.location.href);
    url.search = '';
    if (roomCode) url.searchParams.set('room', roomCode);

    try {
      const blob = createResultCardBlob({
        headline: headline.title,
        headlineEmoji: headline.emoji,
        humanCount,
        aiCount,
        awards: result.awards,
        roomCode,
      });
      const file = new File([blob], 'find-the-human-result.png', { type: 'image/png' });
      const shareNavigator = navigator as {
        share?: (data: ShareData) => Promise<void>;
        canShare?: (data: ShareData) => boolean;
      };
      const nativeShare = shareNavigator.share?.bind(navigator);
      let canShareFile = false;
      try {
        canShareFile = Boolean(nativeShare && shareNavigator.canShare?.({ files: [file] }));
      } catch {
        canShareFile = false;
      }

      if (canShareFile && nativeShare) {
        try {
          await nativeShare({
            title: '인간을 찾아라 결과',
            text: shareText,
            url: url.toString(),
            files: [file],
          });
          return;
        } catch (error) {
          if (isShareAbort(error)) return;
        }
      }

      downloadResultCard(blob, roomCode);
      if (await copyResultText(`${shareText}\n${url.toString()}`)) {
        onNotify('PNG 결과 카드를 저장하고 결과·초대 링크를 복사했어요', 'success');
      } else {
        onNotify('PNG 결과 카드를 저장했어요', 'success');
      }
    } catch {
      if (await copyResultText(`${shareText}\n${url.toString()}`)) {
        onNotify('이미지는 만들지 못했지만 결과·초대 링크를 복사했어요', 'success');
      } else {
        onNotify('결과 카드를 공유하지 못했어요', 'error');
      }
    } finally {
      shareInFlight.current = false;
      setIsSharing(false);
    }
  };

  return (
    <main className="relative min-h-dvh overflow-hidden px-5 pb-[max(30px,env(safe-area-inset-bottom))] pt-[max(18px,env(safe-area-inset-top))]">
      <div className="pointer-events-none absolute -right-28 top-20 h-72 w-72 rounded-full bg-violet-400/[0.09] blur-3xl" />
      <div className="pointer-events-none absolute -left-28 top-72 h-72 w-72 rounded-full bg-electric/[0.07] blur-3xl" />
      <header className="relative flex items-center justify-between">
        <BrandMark compact />
        {roomCode ? (
          <span className="rounded-full border border-white/[0.07] bg-white/[0.035] px-3 py-1.5 font-mono text-[10px] font-black tracking-[0.15em] text-white/35">
            {roomCode}
          </span>
        ) : null}
      </header>

      <section className="relative mt-9 text-center">
        <span className="mx-auto grid h-20 w-20 animate-result-pop place-items-center rounded-[28px] border border-white/10 bg-white/[0.055] text-[40px] shadow-2xl" aria-hidden="true">
          {headline.emoji}
        </span>
        <p className={`mt-5 text-[10px] font-black uppercase tracking-[0.24em] ${headline.color}`}>
          {headline.eyebrow}
        </p>
        <h1 className="mx-auto mt-2 max-w-[340px] text-[30px] font-black leading-[1.15] tracking-[-0.055em] text-white">
          {headline.title}
        </h1>
        <p className="mt-3 text-xs font-medium text-white/35">
          {winner === 'SPECTATOR'
            ? '인간 없는 심리전의 모든 정체를 공개합니다.'
            : '끝까지 숨겨졌던 참가자들의 정체를 공개합니다.'}
        </p>

        <div className="mx-auto mt-5 flex w-fit items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.035] px-3 py-1.5 text-[10px] font-bold text-white/35">
          <span className="text-electric">인간 {humanCount}</span>
          <span className="text-white/15">·</span>
          <span className="text-violet-200">AI {aiCount}</span>
        </div>
      </section>

      <section className="relative mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-black text-white/80">전체 정체</h2>
          <span className="text-[9px] font-black uppercase tracking-widest text-white/25">Identity log</span>
        </div>
        <div className="space-y-2">
          {result.reveal.map((identity, index) => (
            <article
              key={identity.anonName}
              className="flex animate-list-in items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3"
              style={{ animationDelay: `${index * 65}ms` }}
            >
              <span
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xl ${
                  identity.isAI
                    ? 'bg-violet-300/10 ring-1 ring-violet-300/15'
                    : 'bg-electric/10 ring-1 ring-electric/15'
                }`}
                aria-hidden="true"
              >
                {identity.isAI ? '🤖' : '🧑'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-xs font-black text-white/80">{identity.anonName}</h3>
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[8px] font-black uppercase ${
                      identity.isAI
                        ? 'bg-violet-300/10 text-violet-200/75'
                        : 'bg-electric/10 text-electric/75'
                    }`}
                  >
                    {identity.isAI ? 'AI' : 'Human'}
                  </span>
                </div>
                <p className="mt-1 truncate text-[10px] font-semibold text-white/35">
                  {identity.isAI
                    ? identity.personaSummary || '정체를 완벽하게 숨긴 AI'
                    : `실제 닉네임 · ${identity.realNickname || '익명의 인간'}`}
                </p>
              </div>
              <span className="font-mono text-[9px] font-bold text-white/15">
                {String(index + 1).padStart(2, '0')}
              </span>
            </article>
          ))}
        </div>
      </section>

      {result.awards.length ? (
        <section className="relative mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-black text-white/80">오늘의 칭호</h2>
            <span className="text-[9px] font-black uppercase tracking-widest text-amber-200/40">Hall of fame</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {result.awards.map((award, index) => (
              <article
                key={`${award.id}:${award.recipient}`}
                className="animate-list-in rounded-2xl border border-amber-200/10 bg-gradient-to-br from-amber-200/[0.07] to-white/[0.025] p-4"
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-200/10 text-xl" aria-hidden="true">
                    {AWARD_EMOJI[award.id] ?? '✦'}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[9px] font-black uppercase tracking-[0.14em] text-amber-100/45">{award.title}</p>
                    <h3 className="mt-1 break-keep text-sm font-black text-white/85">{award.recipient}</h3>
                    <p className="mt-1 text-[10px] font-medium leading-4 text-white/30">{award.detail}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {result.betLeaderboard.length ? (
        <section className="relative mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-black text-white/80">관전자 예측왕</h2>
            <span className="text-[9px] font-black uppercase tracking-widest text-violet-200/40">Bet leaderboard</span>
          </div>
          <ol className="overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.025]">
            {result.betLeaderboard.map((entry, index) => (
              <li key={entry.nickname} className="flex items-center gap-3 border-b border-white/[0.055] px-4 py-3 last:border-b-0">
                <span className={`grid h-8 w-8 place-items-center rounded-xl text-xs font-black ${
                  index === 0 ? 'bg-amber-200/15 text-amber-100' : 'bg-white/[0.05] text-white/35'
                }`}>
                  {index === 0 ? '👑' : index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-extrabold text-white/65">{entry.nickname}</span>
                <span className="font-mono text-xs font-black text-violet-200/70">
                  {entry.score}<span className="text-white/20">/{entry.total}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="relative mt-8 overflow-hidden rounded-[28px] border border-electric/15 bg-gradient-to-br from-electric/[0.095] via-white/[0.035] to-violet-300/[0.08] p-5 shadow-2xl" aria-label="공유용 게임 결과 카드">
        <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-electric/10 blur-2xl" />
        <div className="relative">
          <p className="text-[9px] font-black uppercase tracking-[0.22em] text-electric/55">My reverse Turing result</p>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-3xl" aria-hidden="true">{headline.emoji}</p>
              <h2 className="mt-2 max-w-[250px] text-xl font-black leading-tight tracking-tight text-white">{headline.title}</h2>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-[10px] font-black text-white/30">HUMAN {humanCount}</p>
              <p className="mt-1 font-mono text-[10px] font-black text-violet-200/55">AI {aiCount}</p>
            </div>
          </div>
          {result.awards[0] ? (
            <p className="mt-4 rounded-xl border border-white/[0.07] bg-black/15 px-3 py-2 text-[10px] font-bold text-white/45">
              {AWARD_EMOJI[result.awards[0].id] ?? '✦'} {result.awards[0].title} · <span className="text-white/75">{result.awards[0].recipient}</span>
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => void shareResult()}
            disabled={isSharing}
            aria-busy={isSharing}
            className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-electric/20 bg-electric/[0.11] text-xs font-black text-electric-soft transition hover:bg-electric/[0.16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric disabled:cursor-wait disabled:opacity-70"
          >
            <CopyIcon className="h-4 w-4" /> {isSharing ? 'PNG 카드 만드는 중…' : '결과 카드 공유하기'}
          </button>
        </div>
      </section>

      <section className="relative mt-7">
        <button
          type="button"
          onClick={onAgain}
          className="flex h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm font-black text-black transition hover:bg-electric-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950"
        >
          <RefreshIcon className="h-5 w-5" />
          같은 방에서 다시 하기
        </button>
        <p className="mt-2.5 text-center text-[10px] font-medium text-white/25">
          {isHost ? '모두 함께 로비로 돌아가 새 게임을 설정합니다.' : '다시 하기를 누르면 같은 방 로비로 돌아갑니다.'}
        </p>
      </section>
    </main>
  );
}
