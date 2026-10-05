import { useState } from 'react';
import { Mic, Send } from 'lucide-react';
import { useApp, useService } from '@/store/AppStore';
import { Spinner, cx } from '@/components/ui';
import { useWhatsAppConnection } from '@/services/whatsapp/useWhatsAppConnection';

/**
 * "Enviar pelo WhatsApp conectado": envia UMA mensagem pela sessão de QR code do usuário.
 * Só aparece quando o WhatsApp está conectado; senão o fluxo wa.me continua igual.
 */
export function SendConnectedButton({
  messageId,
  getText,
  beforeSend,
  small,
  audio,
}: {
  messageId: string;
  /** Texto atual (ex.: durante a edição). Sem isso, envia o texto salvo da mensagem. */
  getText?: () => string;
  beforeSend?: () => void;
  small?: boolean;
  /** Envia como áudio com a voz da IA. */
  audio?: boolean;
}) {
  const service = useService();
  const { toast } = useApp();
  const conn = useWhatsAppConnection();
  const [busy, setBusy] = useState(false);
  if (!service.whatsapp.connectedAvailable || conn?.status !== 'conectado') return null;
  if (audio && !conn.audio) return null;

  async function send() {
    if (busy) return;
    const text = getText?.();
    beforeSend?.();
    setBusy(true);
    const r = await service.whatsapp.sendConnected(messageId, text, { audio });
    setBusy(false);
    if (r.ok) toast(audio ? 'Áudio enviado pelo WhatsApp conectado.' : 'Mensagem enviada pelo WhatsApp conectado.', 'success');
    else toast(r.error, 'error');
  }

  return (
    <button type="button" className={cx(audio ? 'btn-outline' : 'btn-primary', small && 'min-h-[34px] px-3 text-xs')} onClick={send} disabled={busy}>
      {busy ? <Spinner className={small ? 'h-3.5 w-3.5' : undefined} /> : audio ? <Mic className={small ? 'h-3.5 w-3.5' : 'h-4 w-4'} /> : <Send className={small ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}{' '}
      {audio ? 'Enviar como áudio' : 'Enviar pelo WhatsApp conectado'}
    </button>
  );
}
