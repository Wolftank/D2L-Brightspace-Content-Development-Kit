/** One QA gate finding, per the Build resource in docs/architecture.md. */
export interface QaFinding {
  rule: string;
  severity: 'error' | 'warn';
  file: string;
  line: number | null;
  message: string;
  because?: string;
}

/** The QA gate's report on a build. */
export interface QaReport {
  passed: boolean;
  findings: QaFinding[];
}
