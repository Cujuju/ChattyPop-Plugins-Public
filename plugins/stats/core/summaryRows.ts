/** Summary sections need counts by local date, not author identities or individual length frequencies. */
export function summaryRowsSql(source: string, emoji: boolean): string {
  const count = "SUM(json_extract(j.value, '$[1]'))";
  const positive = "SUM(json_extract(j.value, '$[2]'))";
  const negative = "SUM(json_extract(j.value, '$[3]'))";
  return `WITH source AS MATERIALIZED (${source})
    SELECT 'extent' AS kind, '' AS date, '' AS term, 0 AS n, MIN(first_ts) AS first_ts, MAX(last_ts) AS last_ts,
      0 AS seq, 0 AS position, '{}' AS payload FROM source WHERE kind = 'extent' HAVING COUNT(*) > 0
    UNION ALL SELECT 'lengths', s.date, '', ${count}, MIN(s.first_ts), MAX(s.last_ts), 0, 0,
      json_array(json_array(0, ${count}, ${positive}, ${negative}))
      FROM source s CROSS JOIN json_each(s.payload) j WHERE s.kind = 'lengths' GROUP BY s.date
    ${emoji ? "UNION ALL SELECT kind, date, term, n, first_ts, last_ts, seq, position, payload FROM source WHERE kind = 'emoji'" : ''}`;
}
