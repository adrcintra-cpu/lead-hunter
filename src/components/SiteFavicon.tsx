import { useState } from 'react';
import { Globe } from 'lucide-react';
import { cx } from '@/components/ui';

/** Domínio do site (sem protocolo, caminho ou "www."). */
export function siteHost(website?: string | null): string | null {
  if (!website) return null;
  const raw = website.trim();
  if (!raw) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./i, '').toLowerCase();
    return /\.[a-z]{2,}$/i.test(host) ? host : null;
  } catch {
    return null;
  }
}

/**
 * Ícone (favicon) do site da empresa. Só aparece quando o lead tem site; se o site não tiver
 * ícone, mostra um globo neutro. A imagem vem do serviço público de favicons do Google.
 */
export function SiteFavicon({ website, size = 16, className }: { website?: string | null; size?: number; className?: string }) {
  const host = siteHost(website);
  const [state, setState] = useState<'loading' | 'ok' | 'none'>('loading');
  if (!host) return null;
  const box = cx('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[4px]', className);
  if (state === 'none') {
    return (
      <span className={cx(box, 'text-ink-faint')} style={{ width: size, height: size }} aria-hidden>
        <Globe style={{ width: size * 0.85, height: size * 0.85 }} />
      </span>
    );
  }
  return (
    <span className={cx(box, state === 'loading' && 'bg-muted')} style={{ width: size, height: size }} aria-hidden>
      <img
        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className={cx('h-full w-full object-contain', state === 'loading' && 'opacity-0')}
        // O Google devolve um globo de 16 px quando o site não tem ícone: nesse caso usamos o nosso.
        onLoad={(e) => setState(e.currentTarget.naturalWidth <= 16 ? 'none' : 'ok')}
        onError={() => setState('none')}
      />
    </span>
  );
}
