import type { Notice } from '../types';
import { CheckIcon } from './icons';

interface ToastProps {
  notice: Notice;
  onDismiss: () => void;
}

export function Toast({ notice, onDismiss }: ToastProps) {
  const toneClass =
    notice.tone === 'error'
      ? 'border-signal/30 bg-[#251318] text-rose-100'
      : notice.tone === 'success'
        ? 'border-electric/30 bg-[#10201e] text-emerald-50'
        : 'border-white/10 bg-ink-800 text-white';

  return (
    <div
      className={`pointer-events-auto flex w-full max-w-[420px] animate-toast-in items-center gap-3 rounded-2xl border px-4 py-3 text-sm shadow-2xl ${toneClass}`}
      role={notice.tone === 'error' ? 'alert' : 'status'}
    >
      <span
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${
          notice.tone === 'error' ? 'bg-signal/15' : 'bg-electric/15'
        }`}
        aria-hidden="true"
      >
        {notice.tone === 'error' ? '!' : <CheckIcon className="h-4 w-4" />}
      </span>
      <p className="min-w-0 flex-1 font-semibold leading-5">{notice.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-lg text-white/45 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric"
        aria-label="알림 닫기"
      >
        ×
      </button>
    </div>
  );
}
