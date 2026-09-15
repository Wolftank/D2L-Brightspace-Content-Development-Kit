/** One block of a message's content, per the resource model in docs/architecture.md. */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'file'; fileId: string }
  | { type: 'build_ref'; buildId: string }
  | { type: 'deployment_ref'; deploymentId: string };
