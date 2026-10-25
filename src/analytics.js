// Keep development, previews and forks out of the official site's analytics.
const analyticsEnabled = import.meta.env.PROD
  && location.hostname === 'hanglark.github.io'
  && /^\/ambient-portal(?:\/|$)/.test(location.pathname);

export function loadAnalytics() {
  if (!analyticsEnabled || document.querySelector('script[data-cf-beacon]')) return;
  const script = document.createElement('script');
  script.type = 'module';
  script.async = true;
  script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  script.dataset.cfBeacon = JSON.stringify({ token: '104e9d106edc48f2b5a317090a23edfc' });
  document.body.append(script);
}
