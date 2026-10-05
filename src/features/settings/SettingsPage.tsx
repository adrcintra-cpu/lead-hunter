import { useState } from 'react';
import { ShieldOff, Trash2 } from 'lucide-react';
import { useApp, useDb, useService } from '@/store/AppStore';
import { dataMode } from '@/lib/supabase';
import { formatDateTime } from '@/core/utils';
import { DEFAULT_SEND_WINDOW } from '@/core/types';
import { ConfirmDialog, PageHeader, ThemeSwitcher } from '@/components/ui';
import { WhatsAppConnectionCard } from './WhatsAppConnectionCard';
import { AssistantCard } from './AssistantCard';

const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

export function SettingsPage() {
  const db = useDb();
  const service = useService();
  const { toast } = useApp();
  const p = db.profile!;
  const [form, setForm] = useState({
    fullName: p.fullName,
    companyName: p.companyName,
    offer: p.offer,
    icpSegments: p.icpSegments.join(', '),
    icpRegions: p.icpRegions.join(', '),
  });
  const [confirmReset, setConfirmReset] = useState(false);
  const [sup, setSup] = useState({ kind: 'phone' as 'phone' | 'email' | 'cnpj', value: '', reason: '' });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const prov = service.providers;
  const isMock = (id?: string) => !id || id.startsWith('mock');
  const providerRows = [
    { name: 'companySearchProvider', impl: prov.companySearch.map((x) => x.label).join(', '), mock: prov.companySearch.every((x) => isMock(x.id)), note: 'Busca de empresas por segmento e região' },
    ...(prov.places ? [{ name: 'placesProvider', impl: prov.places.label, mock: isMock(prov.places.id), note: 'Consulta pontual de estabelecimento' }] : []),
    { name: 'companyDataProvider', impl: prov.companyData?.label ?? '—', mock: isMock(prov.companyData?.id), note: 'Dados oficiais pelo CNPJ' },
    { name: 'aiProvider', impl: prov.ai.model, mock: isMock(prov.ai.id), note: 'Interpretação, análise, score e abordagem' },
    { name: 'whatsappProvider', impl: prov.whatsapp.label, mock: false, note: 'Só abre a conversa; nada é enviado automaticamente' },
  ];
  const aiOk = db.aiRuns.filter((r) => r.status === 'ok').length;

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-5">
      <PageHeader title="Configurações" />

      <section className="card px-5 py-5">
        <h2 className="text-[15px] font-extrabold">Aparência</h2>
        <p className="mt-1 text-[13px] text-ink-faint">Claro, escuro ou seguir o sistema operacional.</p>
        <div className="mt-3"><ThemeSwitcher /></div>
      </section>

      <section className="card px-5 py-5">
        <h2 className="text-[15px] font-extrabold">Seu perfil e ICP</h2>
        <p className="mt-1 text-[13px] text-ink-faint">Usados no score e para preencher as abordagens geradas.</p>
        <form
          className="mt-4 grid gap-3.5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            service.updateProfile({
              fullName: form.fullName.trim(),
              companyName: form.companyName.trim(),
              offer: form.offer.trim(),
              icpSegments: splitList(form.icpSegments),
              icpRegions: splitList(form.icpRegions),
            });
            toast('Perfil salvo. Recalcule o score de um lead para aplicar o novo ICP.', 'success');
          }}
        >
          <div>
            <label htmlFor="s-name" className="label">Seu nome</label>
            <input id="s-name" className="input" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} />
          </div>
          <div>
            <label htmlFor="s-co" className="label">Sua empresa</label>
            <input id="s-co" className="input" value={form.companyName} onChange={(e) => set('companyName', e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="s-offer" className="label">O que você oferece</label>
            <input id="s-offer" className="input" value={form.offer} placeholder="Ex.: gestão de frota com rastreamento" onChange={(e) => set('offer', e.target.value)} />
          </div>
          <div>
            <label htmlFor="s-seg" className="label">Segmentos do ICP (separados por vírgula)</label>
            <input id="s-seg" className="input" value={form.icpSegments} onChange={(e) => set('icpSegments', e.target.value)} />
          </div>
          <div>
            <label htmlFor="s-reg" className="label">Cidades do ICP (separadas por vírgula)</label>
            <input id="s-reg" className="input" value={form.icpRegions} onChange={(e) => set('icpRegions', e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary">Salvar perfil</button>
          </div>
        </form>
      </section>

      <WhatsAppConnectionCard />

      <AssistantCard />

      <SendingSettings />

      <section className="card px-5 py-5">
        <h2 className="text-[15px] font-extrabold">Providers</h2>
        <p className="mt-1 text-[13px] text-ink-faint">
          Modo atual: <strong className="text-ink">{dataMode === 'mock' ? 'mock (local)' : 'supabase'}</strong>. Cada fonte é substituível sem mudar o resto do sistema; chaves ficam só no servidor.
        </p>
        <ul className="mt-3">
          {providerRows.map((r) => (
            <li key={r.name} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3">
              <div className="min-w-0">
                <div className="font-mono text-[13px] font-semibold">{r.name}</div>
                <div className="text-[12.5px] text-ink-faint">{r.impl} · {r.note}</div>
              </div>
              <span className={r.mock ? 'rounded-md bg-warn-soft px-2 py-1 text-xs font-bold text-warn' : 'rounded-md bg-good-soft px-2 py-1 text-xs font-bold text-good'}>
                {r.mock ? 'Mock' : 'Ativo'}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-ink-faint">{db.aiRuns.length} chamadas de IA registradas ({aiOk} com sucesso).</p>
      </section>

      <section className="card px-5 py-5">
        <h2 className="flex items-center gap-2 text-[15px] font-extrabold"><ShieldOff className="h-4 w-4" /> Lista de supressão (opt-out)</h2>
        <p className="mt-1 text-[13px] text-ink-faint">Contatos aqui não recebem abordagem gerada nem link de WhatsApp.</p>
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            service.addSuppression(sup.kind, sup.value, sup.reason);
            setSup({ ...sup, value: '', reason: '' });
            toast('Contato adicionado à lista de supressão.', 'success');
          }}
        >
          <label htmlFor="sup-kind" className="sr-only">Tipo</label>
          <select id="sup-kind" className="input w-auto" value={sup.kind} onChange={(e) => setSup({ ...sup, kind: e.target.value as typeof sup.kind })}>
            <option value="phone">Telefone</option>
            <option value="email">E-mail</option>
            <option value="cnpj">CNPJ</option>
          </select>
          <label htmlFor="sup-value" className="sr-only">Valor</label>
          <input id="sup-value" className="input min-w-[160px] flex-1" placeholder="Valor" value={sup.value} onChange={(e) => setSup({ ...sup, value: e.target.value })} />
          <label htmlFor="sup-reason" className="sr-only">Motivo</label>
          <input id="sup-reason" className="input min-w-[160px] flex-1" placeholder="Motivo (opcional)" value={sup.reason} onChange={(e) => setSup({ ...sup, reason: e.target.value })} />
          <button type="submit" className="btn-outline" disabled={!sup.value.trim()}>Adicionar</button>
        </form>
        <ul className="mt-3">
          {db.suppression.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 border-t border-line py-2.5 text-[13.5px]">
              <span>
                <span className="font-mono">{s.value}</span>
                <span className="ml-2 text-ink-faint">{s.reason} · {formatDateTime(s.createdAt)}</span>
              </span>
              <button type="button" className="btn-ghost min-h-[32px] px-2" aria-label="Remover da lista de supressão" onClick={() => service.removeSuppression(s.id)}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
          {db.suppression.length === 0 && <li className="text-[13px] text-ink-faint">Nenhum contato na lista.</li>}
        </ul>
      </section>

      {dataMode === 'mock' && (
        <section className="card border-bad/30 px-5 py-5">
          <h2 className="text-[15px] font-extrabold">Dados locais</h2>
          <p className="mt-1 text-[13px] text-ink-faint">Apaga leads, buscas, listas e histórico deste navegador. O perfil continua.</p>
          <button
            type="button"
            className="btn-outline mt-3 text-bad"
            onClick={() => setConfirmReset(true)}
          >
            Apagar dados locais
          </button>
        </section>
      )}
      {confirmReset && (
        <ConfirmDialog
          title="Apagar os dados locais?"
          confirmLabel="Apagar tudo"
          onClose={() => setConfirmReset(false)}
          onConfirm={() => {
            service.resetAll();
            toast('Dados locais apagados.');
          }}
        >
          Leads, buscas, listas e histórico deste navegador serão apagados. Isso não pode ser desfeito.
        </ConfirmDialog>
      )}
    </div>
  );
}

/** Remetente, assinatura e janela de envio das campanhas. */
function SendingSettings() {
  const db = useDb();
  const service = useService();
  const { toast } = useApp();
  const p = db.profile!;
  const w = p.sendWindow ?? DEFAULT_SEND_WINDOW;
  const [f, setF] = useState({ senderEmail: p.senderEmail ?? '', signature: p.signature ?? '', start: w.startHour, end: w.endHour, weekdays: w.weekdaysOnly });
  const valid = f.start < f.end && f.start >= 0 && f.end <= 24 && (!f.senderEmail || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.senderEmail));
  return (
    <section className="card px-5 py-5">
      <h2 className="text-[15px] font-extrabold">Envio das campanhas</h2>
      <p className="mt-1 text-[13px] text-ink-faint">
        WhatsApp sem API: as etapas de WhatsApp viram tarefa com o link wa.me e você envia pelo seu WhatsApp. E-mails das cadências saem pelo servidor. Todo envio respeita a lista de supressão.
      </p>
      <form
        className="mt-4 grid gap-3.5 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          service.updateProfile({
            senderEmail: f.senderEmail.trim() || undefined,
            signature: f.signature.trim() || undefined,
            sendWindow: { startHour: Number(f.start), endHour: Number(f.end), weekdaysOnly: f.weekdays },
          });
          toast('Configurações de envio salvas.', 'success');
        }}
      >
        <div>
          <label htmlFor="snd-email" className="label">E-mail remetente</label>
          <input id="snd-email" type="email" className="input" value={f.senderEmail} placeholder="voce@suaempresa.com.br" onChange={(e) => setF({ ...f, senderEmail: e.target.value })} />
          <p className="mt-1 text-xs text-ink-faint">No modo real, o domínio precisa estar verificado no Resend.</p>
        </div>
        <div>
          <label htmlFor="snd-sig" className="label">Assinatura dos e-mails</label>
          <textarea id="snd-sig" rows={3} className="input py-2" value={f.signature} placeholder={'André Cintra\nSua Empresa · (19) 0000-0000'} onChange={(e) => setF({ ...f, signature: e.target.value })} />
        </div>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
          <div>
            <label htmlFor="snd-start" className="label">Enviar das</label>
            <input id="snd-start" type="number" min={0} max={23} className="input w-24" value={f.start} onChange={(e) => setF({ ...f, start: Number(e.target.value) })} />
          </div>
          <div>
            <label htmlFor="snd-end" className="label">às (hora de Brasília)</label>
            <input id="snd-end" type="number" min={1} max={24} className="input w-24" value={f.end} onChange={(e) => setF({ ...f, end: Number(e.target.value) })} />
          </div>
          <label className="mb-2.5 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.weekdays} onChange={(e) => setF({ ...f, weekdays: e.target.checked })} className="h-4 w-4 accent-[rgb(var(--accent))]" />
            Só em dias úteis
          </label>
        </div>
        {!valid && <p className="text-xs text-bad sm:col-span-2">Confira o e-mail e o horário (início antes do fim).</p>}
        <div className="sm:col-span-2">
          <button type="submit" className="btn-primary" disabled={!valid}>Salvar envio</button>
        </div>
      </form>
      <div className="mt-5 grid gap-2 text-[13px] sm:grid-cols-2">
        <div className="rounded-lg border border-line px-3 py-2.5">
          <div className="font-bold">WhatsApp</div>
          <div className="text-ink-faint">Sem API: link wa.me, envio manual pelo seu WhatsApp</div>
        </div>
        <div className="rounded-lg border border-line px-3 py-2.5">
          <div className="font-bold">E-mail</div>
          <div className="text-ink-faint">{service.automation.runsLocally ? 'Simulado no modo de teste' : 'Resend, via servidor'}</div>
        </div>
      </div>
    </section>
  );
}
