import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileSpreadsheet } from 'lucide-react';
import { useApp, useService } from '@/store/AppStore';
import { ErrorBox, Modal, Spinner } from '@/components/ui';
import { IMPORT_FIELDS, guessMapping, readSpreadsheet, templateCsv, toImportRows, type ImportField } from '@/core/importer/spreadsheet';
import { ProspectButton } from '../campaigns/ProspectButton';

type Parsed = { fileName: string; headers: string[]; rows: string[][]; mapping: (ImportField | null)[] };
type Result = Awaited<ReturnType<ReturnType<typeof useService>['importContacts']>>;

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([templateCsv()], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'modelo-lista-lead-hunter.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Importar uma planilha de contatos para uma lista: escolhe o arquivo, confere as colunas, importa e prospecta. */
export function ImportListModal({ onClose }: { onClose: () => void }) {
  const service = useService();
  const { toast } = useApp();
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [listName, setListName] = useState('');
  const [origin, setOrigin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  async function onFile(e: { target: HTMLInputElement }) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setBusy('Lendo a planilha…');
    try {
      const { headers, rows } = await readSpreadsheet(file);
      if (!rows.length) throw new Error('A planilha só tem o cabeçalho.');
      setParsed({ fileName: file.name, headers, rows, mapping: guessMapping(headers) });
      if (!listName) setListName(file.name.replace(/\.(xlsx|csv)$/i, '').replace(/[_-]+/g, ' ').trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível ler o arquivo.');
    } finally {
      setBusy('');
    }
  }

  const mapped = parsed?.mapping ?? [];
  const hasName = mapped.includes('company') || mapped.includes('tradeName');
  const hasContact = mapped.includes('phone') || mapped.includes('whatsapp') || mapped.includes('email');

  async function run() {
    if (!parsed) return;
    setBusy('Importando…');
    try {
      const rows = toImportRows(parsed.rows, parsed.mapping);
      const r = await service.importContacts({ listName, origin, rows }, (d, t) => setBusy(`Importando ${d} de ${t}…`));
      setResult(r);
      toast(`Lista “${r.list.name}”: ${r.created} novos, ${r.existed} já existiam.`, 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao importar.');
    } finally {
      setBusy('');
    }
  }

  if (result) {
    return (
      <Modal title="Importação concluída" onClose={onClose} wide footer={<button type="button" className="btn-ghost" onClick={onClose}>Fechar</button>}>
        <p className="text-sm">
          <strong>{result.total}</strong> linhas → <strong>{result.created}</strong> novos · <strong>{result.existed}</strong> já existiam (entraram na lista) ·{' '}
          <strong>{result.duplicates}</strong> duplicados na planilha · <strong>{result.optOut}</strong> em opt-out · <strong>{result.invalid}</strong> sem empresa ou contato.
        </p>
        <p className="mt-1 text-[13px] text-ink-faint">
          Tudo está na lista <Link to={`/listas/${result.list.id}`} className="text-accent underline" onClick={onClose}>{result.list.name}</Link>.
        </p>
        {result.leadIds.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-accent/40 bg-accent-soft px-4 py-3">
            <div className="min-w-0 flex-1 text-[13px]">
              <div className="font-bold">Próximo passo: prospectar a lista</div>
              <div className="text-ink-soft">O BEELIE escreve e envia a primeira mensagem de cada contato sozinho, no horário de envio.</div>
            </div>
            <ProspectButton leadIds={result.leadIds} label={`Prospectar lista (${result.leadIds.length})`} />
          </div>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      title="Importar planilha de contatos"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn-primary" disabled={!parsed || !hasName || !hasContact || !listName.trim() || !!busy} onClick={() => void run()}>
            {busy ? <Spinner /> : <FileSpreadsheet className="h-4 w-4" />} {busy || `Importar ${parsed ? parsed.rows.length : ''} contatos`}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <label className="btn-outline cursor-pointer">
            <FileSpreadsheet className="h-4 w-4" /> {parsed ? 'Trocar arquivo' : 'Escolher planilha (.xlsx ou .csv)'}
            <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => void onFile(e)} />
          </label>
          <button type="button" className="btn-ghost" onClick={downloadTemplate}>
            <Download className="h-4 w-4" /> Baixar modelo
          </button>
          {parsed && <span className="text-[13px] text-ink-faint">{parsed.fileName} · {parsed.rows.length} linhas</span>}
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}

        {parsed && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="imp-name" className="label">Nome da lista</label>
                <input id="imp-name" className="input" value={listName} onChange={(e) => setListName(e.target.value)} placeholder="Ex.: Feira Agrishow 2026" />
              </div>
              <div>
                <label htmlFor="imp-origin" className="label">Origem dos contatos</label>
                <input id="imp-origin" className="input" value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="Ex.: feira, evento, parceiro, carteira antiga" />
              </div>
            </div>

            <div>
              <div className="label">Colunas reconhecidas (ajuste se precisar)</div>
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-muted/40">
                      {parsed.headers.map((h, i) => (
                        <th key={i} className="min-w-[130px] px-2 py-2 text-left align-top font-semibold">
                          <div className="truncate text-ink-soft" title={h}>{h || `Coluna ${i + 1}`}</div>
                          <select
                            aria-label={`Campo da coluna ${h || i + 1}`}
                            className="input mt-1 min-h-[30px] py-0.5 text-[12px]"
                            value={parsed.mapping[i] ?? ''}
                            onChange={(e) => {
                              const v = (e.target.value || null) as ImportField | null;
                              setParsed({ ...parsed, mapping: parsed.mapping.map((m, j) => (j === i ? v : m === v && v ? null : m)) });
                            }}
                          >
                            <option value="">Ignorar</option>
                            {IMPORT_FIELDS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                          </select>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 4).map((r, ri) => (
                      <tr key={ri} className="border-b border-line last:border-0">
                        {parsed.headers.map((_, i) => <td key={i} className="max-w-[180px] truncate px-2 py-1.5 text-ink-soft">{r[i]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!hasName && <p className="mt-1.5 text-xs text-warn">Indique a coluna com o nome da empresa.</p>}
              {hasName && !hasContact && <p className="mt-1.5 text-xs text-warn">Indique ao menos uma coluna de WhatsApp, telefone ou e-mail.</p>}
            </div>

            <p className="text-xs leading-relaxed text-ink-faint">
              Duplicados da planilha e quem já é lead são reconhecidos (telefone, WhatsApp, site, CNPJ ou nome + cidade): quem já existe só entra na lista.
              Quem pediu para não ser contatado fica de fora. Use contatos obtidos de forma legítima (feira, evento, parceiro, carteira); a origem fica registrada em cada lead.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
