import { useState, type FormEvent } from 'react';
import { useApp, useService } from '@/store/AppStore';
import { ErrorBox, Modal, Spinner } from '@/components/ui';
import { useLeadDrawer } from '@/app/useLeadDrawer';

/** Cadastro manual de uma empresa: indicação, contato conhecido ou teste. */
export function AddLeadDialog({ onClose }: { onClose: () => void }) {
  const service = useService();
  const { toast } = useApp();
  const drawer = useLeadDrawer();
  const p = service.profile;
  const [f, setF] = useState({
    name: '',
    segment: p.icpSegments[0] ?? '',
    city: p.icpRegions[0] ?? '',
    state: 'SP',
    whatsapp: '',
    email: '',
    contactName: '',
    website: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const emailOk = !f.email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim());
  const valid = f.name.trim() && f.city.trim() && /^[A-Za-z]{2}$/.test(f.state.trim()) && emailOk;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await service.addManualLead(f);
      toast(r.existed ? 'Essa empresa já estava nos seus leads. Abrimos o perfil dela.' : 'Lead adicionado.', r.existed ? 'info' : 'success');
      onClose();
      drawer.open(r.leadId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível adicionar o lead.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Adicionar lead" onClose={onClose}>
      <form onSubmit={submit} className="grid gap-3" noValidate>
        <div>
          <label htmlFor="ml-name" className="label">Empresa *</label>
          <input id="ml-name" className="input" value={f.name} autoFocus onChange={(e) => set('name', e.target.value)} placeholder="Ex.: Oxycom (teste)" />
        </div>
        <div>
          <label htmlFor="ml-seg" className="label">Segmento</label>
          <input id="ml-seg" className="input" value={f.segment} onChange={(e) => set('segment', e.target.value)} placeholder="Ex.: Indústria de plásticos" />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_72px] gap-2">
          <div>
            <label htmlFor="ml-city" className="label">Cidade *</label>
            <input id="ml-city" className="input" value={f.city} onChange={(e) => set('city', e.target.value)} />
          </div>
          <div>
            <label htmlFor="ml-uf" className="label">UF *</label>
            <input id="ml-uf" className="input uppercase" maxLength={2} value={f.state} onChange={(e) => set('state', e.target.value)} />
          </div>
        </div>
        <div>
          <label htmlFor="ml-wa" className="label">WhatsApp</label>
          <input id="ml-wa" className="input" inputMode="tel" value={f.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} placeholder="(19) 99999-9999" />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label htmlFor="ml-contact" className="label">Nome do contato</label>
            <input id="ml-contact" className="input" value={f.contactName} onChange={(e) => set('contactName', e.target.value)} />
          </div>
          <div>
            <label htmlFor="ml-email" className="label">E-mail</label>
            <input id="ml-email" type="email" className="input" value={f.email} onChange={(e) => set('email', e.target.value)} />
            {!emailOk && <p className="mt-1 text-xs text-bad">E-mail inválido.</p>}
          </div>
        </div>
        <div>
          <label htmlFor="ml-site" className="label">Site</label>
          <input id="ml-site" className="input" value={f.website} onChange={(e) => set('website', e.target.value)} placeholder="empresa.com.br" />
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        <p className="text-xs text-ink-faint">Cadastre só contatos comerciais com quem você pode falar. O número informado conta como WhatsApp confirmado.</p>
        <div className="mt-1 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={!valid || busy}>
            {busy && <Spinner />} Adicionar
          </button>
        </div>
      </form>
    </Modal>
  );
}
