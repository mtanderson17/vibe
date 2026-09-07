// Minimal inline SVG icons — no dependencies. Stroke-based, 16px viewbox.

interface Props { name: IconName; size?: number }

export type IconName =
  | 'grid'
  | 'list'
  | 'coin'
  | 'note'
  | 'settings'
  | 'plus'
  | 'close'
  | 'stop'
  | 'send'
  | 'sparkle'

const paths: Record<IconName, JSX.Element> = {
  grid: (
    <>
      <rect x="2" y="2" width="5.5" height="5.5" rx="1" />
      <rect x="8.5" y="2" width="5.5" height="5.5" rx="1" />
      <rect x="2" y="8.5" width="5.5" height="5.5" rx="1" />
      <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" />
    </>
  ),
  list: (
    <>
      <rect x="2" y="3" width="3" height="3" rx="0.5" />
      <rect x="2" y="10" width="3" height="3" rx="0.5" />
      <line x1="7" y1="4.5" x2="14" y2="4.5" />
      <line x1="7" y1="11.5" x2="14" y2="11.5" />
    </>
  ),
  coin: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M10 6c0-1.1-.9-2-2-2s-2 .9-2 2c0 2 4 2 4 4 0 1.1-.9 2-2 2s-2-.9-2-2" />
      <line x1="8" y1="3" x2="8" y2="4" />
      <line x1="8" y1="12" x2="8" y2="13" />
    </>
  ),
  note: (
    <>
      <rect x="3" y="2" width="10" height="12" rx="1" />
      <line x1="5.5" y1="5" x2="10.5" y2="5" />
      <line x1="5.5" y1="8" x2="10.5" y2="8" />
      <line x1="5.5" y1="11" x2="9" y2="11" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M13.5 8c0-.4-.05-.8-.1-1.2l1.4-1.1-1.5-2.6-1.7.7c-.6-.5-1.3-.9-2.1-1.2L9.3 1H6.7l-.2 1.6c-.8.3-1.5.7-2.1 1.2l-1.7-.7-1.5 2.6 1.4 1.1c-.05.4-.1.8-.1 1.2s.05.8.1 1.2L1.2 10.3l1.5 2.6 1.7-.7c.6.5 1.3.9 2.1 1.2l.2 1.6h2.6l.2-1.6c.8-.3 1.5-.7 2.1-1.2l1.7.7 1.5-2.6-1.4-1.1c.05-.4.1-.8.1-1.2z" />
    </>
  ),
  plus: (
    <>
      <line x1="8" y1="3" x2="8" y2="13" />
      <line x1="3" y1="8" x2="13" y2="8" />
    </>
  ),
  close: (
    <>
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </>
  ),
  stop: (
    <rect x="4" y="4" width="8" height="8" rx="1" />
  ),
  send: (
    <>
      <line x1="2" y1="8" x2="14" y2="2" />
      <polyline points="2 8 6 10 8 14 14 2" />
    </>
  ),
  sparkle: (
    <>
      <path d="M8 2v3M8 11v3M2 8h3M11 8h3" />
      <path d="M4.5 4.5l2 2M9.5 9.5l2 2M4.5 11.5l2-2M9.5 6.5l2-2" />
    </>
  )
}

export default function Icon({ name, size = 16 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}
