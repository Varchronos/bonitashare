import nodemailer from 'nodemailer';

// Transactional email over SMTP to an SES Mail Manager ingress endpoint. The EMAIL_FROM domain has to
// be verified in SES, or the mail is refused.
const HOST = process.env.SES_SMTP_HOST;
const PORT = Number(process.env.SES_SMTP_PORT || 587);
const USERNAME = process.env.SES_SMTP_USERNAME;
const PASSWORD = process.env.SES_SMTP_PASSWORD;
const FROM_ADDRESS = process.env.EMAIL_FROM;
const FROM_NAME = process.env.EMAIL_FROM_NAME || 'bonitashare';

const TIMEOUT_MS = 10_000;

const transporter =
    HOST && USERNAME && PASSWORD && FROM_ADDRESS
        ? nodemailer.createTransport({
              host: HOST,
              port: PORT,
              // 587 starts plain and upgrades with STARTTLS; requireTLS refuses to send if the upgrade fails,
              // matching the endpoint's "TLS Required" policy. 465 is TLS from the first byte.
              secure: PORT === 465,
              requireTLS: true,
              auth: { user: USERNAME, pass: PASSWORD },
              connectionTimeout: TIMEOUT_MS,
              greetingTimeout: TIMEOUT_MS,
              socketTimeout: TIMEOUT_MS,
          })
        : null;

type Email = { to: string; subject: string; text: string; html: string };

export async function sendEmail(email: Email, log: { info: (obj: object, msg: string) => void }) {
    if (!transporter) {
        if (process.env.NODE_ENV === 'production') throw new Error('Email sending is not configured');
        // Locally there's usually no SMTP account: print it instead so the flow can still be tried.
        log.info({ to: email.to, subject: email.subject, text: email.text }, 'email not sent (sending not configured)');
        return;
    }

    await transporter.sendMail({ ...email, from: { name: FROM_NAME, address: FROM_ADDRESS! } });
}
