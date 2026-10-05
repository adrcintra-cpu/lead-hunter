/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Saira', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        subtle: token('subtle'),
        muted: token('muted'),
        line: token('line'),
        'line-strong': token('line-strong'),
        ink: token('ink'),
        'ink-soft': token('ink-soft'),
        'ink-faint': token('ink-faint'),
        accent: token('accent'),
        'accent-ink': token('accent-ink'),
        'accent-soft': token('accent-soft'),
        'accent-strong': token('accent-strong'),
        good: token('good'),
        'good-soft': token('good-soft'),
        warn: token('warn'),
        'warn-soft': token('warn-soft'),
        bad: token('bad'),
        'bad-soft': token('bad-soft'),
        ai: token('ai'),
        'ai-soft': token('ai-soft'),
        inverse: token('inverse'),
        'inverse-ink': token('inverse-ink'),
      },
      boxShadow: {
        pop: '0 12px 32px -12px rgb(0 0 0 / 0.25)',
      },
    },
  },
  plugins: [],
};
