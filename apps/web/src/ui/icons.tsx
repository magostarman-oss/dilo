const base = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const MicIcon = () => (
  <svg {...base}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);
export const ArrowUpIcon = () => (
  <svg {...base}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);
export const CheckIcon = () => (
  <svg {...base} width={14} height={14} strokeWidth={2.4}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
export const CloseIcon = () => (
  <svg {...base} width={16} height={16}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const StopIcon = () => (
  <svg {...base}>
    <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
  </svg>
);
export const CalendarIcon = () => (
  <svg {...base} width={16} height={16}>
    <rect x="3.5" y="5" width="17" height="15" rx="3" />
    <path d="M3.5 10h17M8 3v4M16 3v4M12 13v4M10 15h4" />
  </svg>
);
