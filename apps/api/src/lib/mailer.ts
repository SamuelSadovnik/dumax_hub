import nodemailer from 'nodemailer';
import { env } from '../env';

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

export const mailEnabled = () => transport !== null;

/** Envia e-mail. Sem SMTP configurado, apenas loga (modo dev). */
export async function sendMail(to: string, subject: string, html: string): Promise<{ sent: boolean }> {
  if (!transport) {
    console.log(`\n📧 [e-mail simulado] para: ${to}\n   assunto: ${subject}\n   ${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400)}\n`);
    return { sent: false };
  }
  await transport.sendMail({ from: env.MAIL_FROM, to, subject, html });
  return { sent: true };
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Template simples com a cara da Dumax */
export function mailLayout(title: string, paragraphs: string[], cta?: { label: string; url: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
  <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden">
    <tr><td style="background:#14110f;color:#fff;padding:20px 28px;font-size:20px;font-weight:bold">dumax<span style="color:#ff5a1f">.</span>hub</td></tr>
    <tr><td style="padding:28px">
      <h1 style="font-size:20px;color:#14110f;margin:0 0 16px">${escape(title)}</h1>
      ${paragraphs.map((p) => `<p style="font-size:15px;line-height:1.6;color:#3f3f46;margin:0 0 12px">${escape(p).replace(/\n/g, '<br>')}</p>`).join('')}
      ${cta ? `<p style="margin:24px 0 0"><a href="${cta.url}" style="background:#ff5a1f;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block">${escape(cta.label)}</a></p>` : ''}
    </td></tr>
  </table></td></tr></table></body></html>`;
}
