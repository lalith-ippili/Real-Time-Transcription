// Turns low-level PostgreSQL / network errors into a short reason code and a
// human hint. Never includes secrets, so it is safe to return from /api/health.

const NETWORK_CODES = new Set([
  'ENOTFOUND',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
]);

const parseUrl = (url) => {
  try {
    const { hostname } = new URL(url);
    return { host: hostname };
  } catch {
    return { host: '' };
  }
};

export const isConnectionError = (err) =>
  Boolean(
    err &&
      (NETWORK_CODES.has(err.code) ||
        err.code === '28P01' ||
        /Tenant or user not found|Connection terminated|connection timeout|DATABASE_URL is not configured/i.test(
          err.message || '',
        )),
  );

/** @returns {{ reason: string, hint: string|null }} */
export const diagnoseDbError = (err, databaseUrl) => {
  const message = String(err?.message || '');
  const code = err?.code;

  if (!databaseUrl) {
    return { reason: 'not_configured', hint: 'Set the DATABASE_URL environment variable on the server.' };
  }
  if (databaseUrl.includes('[YOUR-')) {
    return {
      reason: 'placeholder_password',
      hint: 'DATABASE_URL still contains the [YOUR-PASSWORD] placeholder. Put the real password in.',
    };
  }

  const { host } = parseUrl(databaseUrl);
  const isDirectSupabase = /^db\..+\.supabase\.co$/.test(host);

  if (isDirectSupabase && (NETWORK_CODES.has(code) || /ENETUNREACH|ENOTFOUND|EHOSTUNREACH/.test(message))) {
    return {
      reason: 'ipv6_only_host',
      hint:
        'The direct Supabase host (db.<ref>.supabase.co) is IPv6-only and this server has no IPv6 route. ' +
        'Use the Session pooler connection string from Supabase → Connect instead.',
    };
  }
  if (code === '28P01' || /password authentication failed/i.test(message)) {
    return {
      reason: 'auth_failed',
      hint: 'Wrong database password. URL-encode special characters in it (for example @ → %40, # → %23).',
    };
  }
  if (/Tenant or user not found/i.test(message)) {
    return {
      reason: 'pooler_user',
      hint: 'With the Supabase pooler the user name must be postgres.<project-ref>, e.g. postgres.jdcmwroecgvidfgcucvw.',
    };
  }
  if (/self[- ]signed|certificate/i.test(message)) {
    return { reason: 'tls', hint: 'TLS error: keep DB_SSL=auto and remove sslmode=verify-full from the URL.' };
  }
  if (code === 'ETIMEDOUT' || /timeout/i.test(message)) {
    return {
      reason: 'timeout',
      hint: 'The database did not answer in time. Check host and port, and resume the project if Supabase paused it.',
    };
  }
  if (NETWORK_CODES.has(code)) {
    return { reason: 'unreachable', hint: 'The database host is unreachable. Check DATABASE_URL.' };
  }
  return { reason: 'unknown', hint: null };
};
