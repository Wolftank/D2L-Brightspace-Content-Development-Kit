import type { QaFinding } from '@cdk/contract';

const SEVERITY_LABEL: Record<QaFinding['severity'], string> = { error: 'Needs a fix', warn: 'Worth a look' };

/** The findings of each rule, with the rules that need a fix first. */
function byRule(findings: QaFinding[]): QaFinding[][] {
  const rules = new Map<string, QaFinding[]>();
  for (const finding of findings) rules.set(finding.rule, [...(rules.get(finding.rule) ?? []), finding]);
  return [...rules.values()].sort((a, b) => Number(a[0]!.severity === 'warn') - Number(b[0]!.severity === 'warn'));
}

/**
 * A build's QA findings, one entry per rule: its severity and its
 * plain-language explanation, with the technical text of each place the rule
 * was broken behind Details.
 */
export function QaFindings({ findings }: { findings: QaFinding[] }) {
  return <ul className="qa-findings">{byRule(findings).map(places => {
    const { rule, severity, explanation, because } = places[0]!;
    return <li key={rule} className={`finding-${severity}`}>
      <p className="finding-heading"><strong>{SEVERITY_LABEL[severity]}</strong>{places.length > 1 && <span>{places.length} places</span>}</p>
      <p>{explanation}</p>
      <details>
        <summary>Details</summary>
        {places.map(({ file, line, message }, index) =>
          <p key={index}><span className="finding-location">{line === null ? file : `${file}:${line}`}</span> {message}</p>)}
        {because && <p>{because}</p>}
      </details>
    </li>;
  })}</ul>;
}
