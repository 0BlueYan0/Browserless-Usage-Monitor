export function GaugeMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#4f46e5" />
      <path d="M16 40a16 16 0 0 1 32 0" fill="none" stroke="#c7d2fe" strokeWidth="5" strokeLinecap="round" />
      <path
        d="M16 40a16 16 0 0 1 9.5-14.6"
        fill="none"
        stroke="#67e8f9"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <circle cx="32" cy="40" r="3.5" fill="#fff" />
      <line x1="32" y1="40" x2="42" y2="30" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  )
}

export function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <GaugeMark size={26} />
      <div className="leading-none">
        <div className="font-mono text-[0.7rem] tracking-[0.22em] text-muted">BROWSERLESS</div>
        <div className="font-mono text-[0.7rem] tracking-[0.22em] text-fg">USAGE·MONITOR</div>
      </div>
    </div>
  )
}
