// In-browser stand-in for the Aviator backend, so the game is playable (play money) with no server.
// Set REACT_APP_SOCKET_URL to talk to a real server instead.
import { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { CrashServer, hmacSha256Hex } from '../engine';

export const USE_MOCK = !process.env.REACT_APP_SOCKET_URL;

const START_BALANCE = 10000;
const wallet = {
    get: () => {
        try {
            const v = parseFloat(localStorage.getItem('playBalance') || '');
            return Number.isFinite(v) ? v : START_BALANCE;
        } catch { return START_BALANCE }
    },
    set: (n: number) => { try { localStorage.setItem('playBalance', String(n)) } catch { } },
};

let server: CrashServer | null = null;
export const getServer = () => {
    if (!server) {
        server = new CrashServer({ hmac: hmacSha256Hex, wallet });
        server.start();
    }
    return server;
};
export const resetBalance = () => wallet.set(START_BALANCE);

type Handler = (...args: any[]) => void;

export function mockIo() {
    const srv = getServer();
    const handlers = new Map<string, Set<Handler>>();
    const fire = (ev: string, payload?: any) => setTimeout(() => handlers.get(ev)?.forEach((h) => h(payload)), 0);

    const unsub = srv.subscribe((e) => {
        if (e.type === 'message') fire('message', { message: e.message, update: e.update });
        else { const { type, ...rest } = e; fire(type, rest) }
    });

    const socket = {
        on(ev: string, h: Handler) {
            if (!handlers.has(ev)) handlers.set(ev, new Set());
            handlers.get(ev)!.add(h);
            // a late joiner (the player taps Start mid-round) still needs the current phase
            if (ev === 'message') {
                if (srv.phase === 'betting') fire('message', { message: 'GAME_ALLOW_BET' });
                else if (srv.phase === 'flying') fire('message', { message: 'GAME_START' });
            }
            return socket;
        },
        off(ev: string, h?: Handler) { h ? handlers.get(ev)?.delete(h) : handlers.delete(ev); return socket },
        emit(ev: string, arg?: unknown) {
            if (ev === 'cashout' || ev === 'auto-cashout') {
                const id = parseInt(String(arg).replace('crash-round-', ''), 10);
                srv.cashOut(id, ev === 'auto-cashout');
            }
            return socket;
        },
        removeAllListeners() { handlers.clear(); return socket },
        disconnect() { unsub(); handlers.clear(); return socket },
    };
    fire('connect');
    return socket as any;
}

const reply = (config: InternalAxiosRequestConfig, data: unknown): AxiosResponse =>
    ({ data, status: 200, statusText: 'OK', headers: {}, config, request: {} });

export const mockAdapter: AxiosAdapter = async (config) => {
    const srv = getServer();
    const url = (config.url || '').replace(/^https?:\/\/[^/]+/, '');
    const body = typeof config.data === 'string' ? JSON.parse(config.data || '{}') : (config.data || {});
    const cfg = config as InternalAxiosRequestConfig;

    if (url === '/api/config') return reply(cfg, { data: srv.config() });
    if (url === '/api/user/games/create') return reply(cfg, { hash: srv.fairness().hash });
    if (url === '/api/crash/play/recent-rec') return reply(cfg, { data: srv.recent() });
    if (url === '/api/games/crash/play/top-identifier') return reply(cfg, { status: true, data: srv.top() });
    if (url === '/api/games/crash/play/bet-place') return reply(cfg, srv.placeBet(Number(body.bet), body.auto_cashout));
    if (url === '/api/games/crash/play/cancel-bet') return reply(cfg, srv.cancelBet(Number(body.gameID)));
    let m = url.match(/^\/api\/games\/crash\/(\d+)\/cash-out$/);
    if (m) return reply(cfg, srv.claimWin(Number(m[1])));
    m = url.match(/^\/api\/games\/crash\/(\d+)\/complete$/);
    if (m) return reply(cfg, { status: true });
    return reply(cfg, { status: false, message: `mock: unknown route ${url}` });
};
