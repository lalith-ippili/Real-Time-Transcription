// Origin allow-list shared by the REST API (CORS) and the live WebSocket relay.
// Patterns: exact origins, "*" (allow all) and wildcards such as
// "https://*--your-app.netlify.app" for Netlify deploy previews.

export const buildOriginMatcher = (patterns) => {
  const matchers = patterns.map((pattern) => {
    if (pattern === '*') return () => true;
    const clean = pattern.replace(/\/$/, '');
    if (!clean.includes('*')) return (origin) => origin === clean;
    const regex = new RegExp(
      `^${clean
        .split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]+')}$`,
    );
    return (origin) => regex.test(origin);
  });
  return (origin) => matchers.some((match) => match(origin));
};
