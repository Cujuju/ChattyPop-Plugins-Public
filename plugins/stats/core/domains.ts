import { getDomain } from 'tldts';
import { STATS_TOP, type ActivityStats } from '../shared/types';

/** Private suffixes keep independently hosted sites, such as github.io projects, separate. */
export function domainTree(urls: { url: string; n: number }[]): ActivityStats['domains'] {
  const sites = new Map<string, Map<string, number>>();
  for (const { url, n } of urls) {
    let host: string;
    try { host = new URL(url).hostname.replace(/\.$/, ''); } catch { continue; }
    if (!host) continue;
    const domain = getDomain(host, { allowPrivateDomains: true }) ?? host;
    const hosts = sites.get(domain) ?? new Map<string, number>();
    hosts.set(host, (hosts.get(host) ?? 0) + n);
    sites.set(domain, hosts);
  }
  return [...sites].map(([domain, counts]) => {
    const hosts = [...counts].map(([host, count]) => ({ host, count }))
      .sort((a, b) => b.count - a.count || a.host.localeCompare(b.host));
    return { domain, count: hosts.reduce((total, host) => total + host.count, 0), hosts };
  }).sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain)).slice(0, STATS_TOP);
}
