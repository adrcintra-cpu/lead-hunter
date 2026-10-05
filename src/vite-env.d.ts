/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_MODE?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SEARCH_PROVIDER?: string;
  /** Endereço público do serviço de WhatsApp por QR code (whatsapp-service). Opcional. */
  readonly VITE_WHATSAPP_SERVICE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
