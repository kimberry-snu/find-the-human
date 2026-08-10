import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const baseProps = {
  fill: 'none',
  viewBox: '0 0 24 24',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function ArrowIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="m21 3-7.3 18-4.1-7.2L3 10.5 21 3Z" />
      <path d="m9.6 13.8 4-3.6" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M16 20v-1.5A3.5 3.5 0 0 0 12.5 15h-5A3.5 3.5 0 0 0 4 18.5V20" />
      <circle cx="10" cy="8" r="3" />
      <path d="M17 11a2.5 2.5 0 0 0 0-5M18 15a3 3 0 0 1 3 3v1" />
    </svg>
  );
}

export function CrownIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="m4 8 4 3 4-6 4 6 4-3-2 10H6L4 8Z" />
      <path d="M6 21h12" />
    </svg>
  );
}

export function WifiOffIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="m3 3 18 18M8.5 8.5A10 10 0 0 1 20 10M5 10a10 10 0 0 1 1.8-1.1M8.5 14a5 5 0 0 1 7 0M12 19h.01" />
    </svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M20 6v5h-5M4 18v-5h5" />
      <path d="M18.5 10A7 7 0 0 0 6.1 6.1L4 8M5.5 14A7 7 0 0 0 17.9 17.9L20 16" />
    </svg>
  );
}
