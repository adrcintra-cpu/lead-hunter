import { useEffect, useState } from 'react';
import { ErrorBox, Skeleton } from '@/components/ui';
import { formatDateTime } from '@/core/utils';
import { supabase } from '@/lib/supabase';
import { PLATFORM_LABEL, type MetaLead } from '@/services/metaLeads';

/** Respostas do formulário de anúncio, campanha e anúncio de origem (dado real vindo da Meta). */
export function MetaLeadForm({ leadId, item }: { leadId?: string; item?: MetaLead }) {
  const [rows, setRows] = useState<MetaLead[] | null>(item ? [item] : null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (item || !leadId || !supabase) return;
    supabase
      .from('meta_leads')
      .select('id, meta_lead_id, page_ref, form_id, form_name, ad_name, adset_name, campaign_name, platform, is_organic, created_time, field_data, contact, lead_id, imported_via, enrolled_at, skip_reason')
      .eq('lead_id', leadId)
      .order('created_time', { ascending: false })
      .limit(5)
      .then(({ data, error: e }) => {
        if (e) setError(e.message);
        setRows((data ?? []) as MetaLead[]);
      });
  }, [leadId, item]);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!rows) return <Skeleton className="h-24 w-full" />;
  if (!rows.length) return <p className="text-[13px] text-ink-faint">Nenhum formulário da Meta ligado a este lead.</p>;
  return (
    <div className="flex flex-col gap-4">
      {rows.map((m) => (
        <div key={m.id} className="flex flex-col gap-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
            <dt className="text-ink-faint">Recebido</dt>
            <dd>{m.created_time ? formatDateTime(m.created_time) : '—'} · {m.imported_via === 'importacao' ? 'importado do histórico' : 'na hora (webhook)'}</dd>
            <dt className="text-ink-faint">Canal</dt>
            <dd>{(m.platform && PLATFORM_LABEL[m.platform]) || 'Não informado pela Meta'}{m.is_organic ? ' · orgânico' : ''}</dd>
            <dt className="text-ink-faint">Formulário</dt>
            <dd>{m.form_name ?? m.form_id ?? '—'}</dd>
            <dt className="text-ink-faint">Campanha</dt>
            <dd>{m.campaign_name ?? <span className="text-ink-faint">Não disponível (falta a permissão ads_read)</span>}</dd>
            <dt className="text-ink-faint">Conjunto</dt>
            <dd>{m.adset_name ?? '—'}</dd>
            <dt className="text-ink-faint">Anúncio</dt>
            <dd>{m.ad_name ?? '—'}</dd>
            <dt className="text-ink-faint">Beelie</dt>
            <dd>{m.enrolled_at ? `Na campanha do Beelie desde ${formatDateTime(m.enrolled_at)}` : m.skip_reason ? `Sem contato automático: ${m.skip_reason}` : m.imported_via === 'importacao' ? 'Lead antigo: sem contato automático' : '—'}</dd>
          </dl>
          <div className="rounded-[14px] bg-ink/[0.03] p-3">
            <div className="mb-1.5 text-[12px] font-bold text-ink-soft">Respostas do formulário</div>
            <ul className="flex flex-col gap-1 text-[13px]">
              {m.field_data.map((f) => (
                <li key={f.name} className="break-words">
                  <span className="text-ink-faint">{f.name.replace(/_/g, ' ')}:</span> {f.values.join(', ') || '—'}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}
