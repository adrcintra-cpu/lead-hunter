import { useEffect, useRef } from 'react';

/**
 * Esfera de partículas que respira e gira devagar (fundo do login).
 * Pontos numa esfera (espiral de Fibonacci) deformados por ondas suaves, desenhados num canvas.
 * Com "reduzir movimento" ligado no sistema, fica parada.
 */
export function ParticleSphere({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    const N = 6500;
    const pts: [number, number, number][] = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = golden * i;
      pts.push([Math.cos(th) * r, y, Math.sin(th) * r]);
    }

    let w = 0;
    let h = 0;
    let dpr = 1;
    const resize = () => {
      const box = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = box.width;
      h = box.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    const draw = (ms: number) => {
      const t = ms / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const R = Math.min(w, h) * 0.38;
      const cx = w / 2;
      const cy = h / 2;
      const rotY = t * 0.12;
      const rotX = 0.35 + Math.sin(t * 0.07) * 0.08;
      // Brilho suave atrás da esfera.
      const glow = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.35);
      glow.addColorStop(0, 'rgba(70, 110, 220, 0.16)');
      glow.addColorStop(1, 'rgba(70, 110, 220, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      const cY = Math.cos(rotY), sY = Math.sin(rotY), cX = Math.cos(rotX), sX = Math.sin(rotX);
      for (const [px, py, pz] of pts) {
        // Deformação: ondas que percorrem a superfície ("respiração" orgânica).
        const wave = 1 + 0.07 * Math.sin(px * 4 + t * 0.9) * Math.cos(py * 3 - t * 0.7) + 0.04 * Math.sin(pz * 5 + t * 1.3);
        let x = px * wave, y = py * wave, z = pz * wave;
        const x1 = x * cY + z * sY;
        const z1 = -x * sY + z * cY;
        const y1 = y * cX - z1 * sX;
        const z2 = y * sX + z1 * cX;
        x = x1; y = y1; z = z2;
        const depth = (z + 1.2) / 2.4; // 0 = fundo, 1 = frente
        const persp = 1 / (1.9 - z * 0.45);
        const sx = cx + x * R * persp * 1.5;
        const sy = cy + y * R * persp * 1.5;
        // Borda da esfera mais brilhante (efeito de luz rasante), centro mais apagado.
        const rim = Math.min(1, Math.abs(Math.hypot(x, y)) ** 3 * 1.1);
        const a = 0.22 + depth * 0.5 + rim * 0.55;
        const size = 0.8 + depth * 1.5;
        ctx.fillStyle = `rgba(${150 + rim * 90 | 0}, ${185 + rim * 60 | 0}, 255, ${Math.min(1, a)})`;
        ctx.fillRect(sx, sy, size, size);
      }
      if (!still) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden />;
}
