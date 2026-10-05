import { useSyncExternalStore } from 'react';
import { waStatusStore, whatsappQrAvailable, type WaStatusView } from '@/lib/whatsappClient';

const noop = () => () => undefined;

/** Status do WhatsApp conectado (QR code), compartilhado entre as telas. null = ainda carregando ou indisponível. */
export function useWhatsAppConnection(): WaStatusView | null {
  return useSyncExternalStore(whatsappQrAvailable ? waStatusStore.subscribe : noop, waStatusStore.get, () => null);
}
