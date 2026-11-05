/**
 * Integração com o Oxyhub (login único dos sistemas Oxycom).
 * O login acontece no hub; o Lead Hunter só recebe a pessoa já autenticada.
 */
export const HUB_URL = (((import.meta.env.VITE_HUB_URL as string | undefined) || 'https://hub.oxyhub.com.br')).replace(/\/+$/, '');
export const HUB_SIGN_OUT = `${HUB_URL}/sair`;

const TRIED = 'oxyhub-login-redirect';
const LOCAL = 'oxyhub-login-local';

/**
 * Manda a pessoa para o login do Oxyhub, que devolve aqui já logada.
 * Não redireciona (mostra o login local) com ?local=1, quando o link falhou
 * ou se já tentamos há pouco — evita ficar indo e voltando se algo der errado.
 */
export function goToHubLogin(): boolean {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('local') === '1') sessionStorage.setItem(LOCAL, '1');
    const hashError = /error=|error_description=/.test(window.location.hash);
    if (sessionStorage.getItem(LOCAL) === '1' || hashError || url.searchParams.has('error')) return false;
    const last = Number(sessionStorage.getItem(TRIED) || 0);
    if (Date.now() - last < 120_000) return false;
    sessionStorage.setItem(TRIED, String(Date.now()));
  } catch {
    /* sem sessionStorage: segue para o hub */
  }
  window.location.replace(`${HUB_URL}/abrir/lead`);
  return true;
}

/** Já logado: libera um novo redirecionamento no futuro. */
export function clearHubLoginAttempt() {
  try {
    sessionStorage.removeItem(TRIED);
  } catch {
    /* ignore */
  }
}
