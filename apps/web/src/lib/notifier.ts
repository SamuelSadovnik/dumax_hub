/**
 * Toque curto de mensagem (Web Audio — sem arquivo de som) e notificação do navegador.
 */
let ctx: AudioContext | null = null;
let lastPlay = 0;

export function playMessageSound() {
  const now = Date.now();
  if (now - lastPlay < 800) return; // evita rajada quando chegam várias juntas
  lastPlay = now;
  try {
    ctx ??= new AudioContext();
    const t = ctx.currentTime;
    const notes = [
      { f: 880, at: 0 },
      { f: 1318.5, at: 0.09 },
    ];
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.f;
      gain.gain.setValueAtTime(0.0001, t + n.at);
      gain.gain.exponentialRampToValueAtTime(0.16, t + n.at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + n.at + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + n.at);
      osc.stop(t + n.at + 0.25);
    }
  } catch {
    /* navegador bloqueou áudio */
  }
}

const SOUND_KEY = 'dumax.sound';
export const soundPrefs = {
  enabled(): boolean {
    try {
      return localStorage.getItem(SOUND_KEY) !== 'off';
    } catch {
      return true;
    }
  },
  set(on: boolean) {
    try {
      localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  },
};

export function browserNotify(title: string, body: string, onClick: () => void, tag = 'dumax-chat') {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || !document.hidden) return;
  try {
    const n = new Notification(title, { body, icon: '/favicon.svg', tag });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  } catch {
    /* ignore */
  }
}

export async function askNotificationPermission() {
  if (typeof Notification === 'undefined') return 'unsupported' as const;
  if (Notification.permission === 'default') return Notification.requestPermission();
  return Notification.permission;
}

/** Som discreto para avisos que não são mensagem */
export function playNotificationSound() {
  try {
    ctx ??= new AudioContext();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.32);
  } catch {
    /* ignore */
  }
}
