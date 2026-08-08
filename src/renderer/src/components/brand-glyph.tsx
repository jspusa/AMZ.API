export default function BrandGlyph({ className }: { className: string }) {
  return (
    <span className={className} aria-hidden="true">
      <svg viewBox="28 23 76 84" focusable="false">
        <g transform="translate(-3 -3)">
          <path
            d="M76 34h13v31.1C89 79.4 80.5 88 66.5 88 53.1 88 44.4 80.6 44 67.6h12.8c.5 6.1 3.7 9.2 9.8 9.2 6.3 0 9.4-3.8 9.4-11.5V34Z"
            fill="currentColor"
          />
          <path
            d="M43 96c14.2 8.1 34.3 8.5 48.2-1.7"
            fill="none"
            stroke="#e32636"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <path
            d="m86.5 91.5 7 1.2-2.2 6.6"
            fill="none"
            stroke="#e32636"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </svg>
    </span>
  );
}
