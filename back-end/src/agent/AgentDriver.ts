import type { ZodType } from 'zod';

export type AgentName = 'claude' | 'copilot';

/**
 * Drives one agent on behalf of the session service and the runner.
 *
 * Each driver translates these calls into one agent's SDK, so everything
 * above stays agent-agnostic.
 */
export interface AgentDriver {
  readonly name: AgentName;

  /** Reports whether the agent is installed and signed in on this host. */
  probe(): Promise<ProbeResult>;

  /** Opens a session in a workspace, reopening `sessionId` when given. */
  open(req: SessionRequest): Promise<AgentSession>;
}

export interface ProbeResult {
  ok: boolean;
  version?: string;
  /** Human-readable explanation when `ok` is false. */
  detail?: string;
}

export interface SessionRequest {
  /** The project's workspace. The agent runs inside it. */
  workspaceDir: string;

  /** The agent's session id for this project, when one exists. A driver
   *  that cannot reopen it starts a new session and emits a `notice` event
   *  on the first turn. */
  sessionId: string | null;

  /** Project facts and the kit's rules, delivered to the agent the way it
   *  takes them. */
  instructions: string;

  /** The kit's skills directory, delivered to the agent the way it takes
   *  them. */
  skillsDir: string;

  /** Tools exposed to the agent, bound to this project and instructor. */
  tools: ToolServerSpec;

  /** Tool names pre-approved for the session, in the agent's qualified
   *  form, e.g. `mcp__cdk__create_build`. Edits inside `workspaceDir` and
   *  shell commands are always allowed to callers of this interface; making
   *  that true for a given agent's SDK is the driver's job, and may take
   *  agent-specific work — see that agent's section in docs/drivers.md.
   *  Every other tool call is denied. */
  allowedTools: string[];
}

/**
 * An open exchange between the driver and its agent for one project.
 *
 * Whether a process stays alive between turns is the driver's choice; the
 * session service closes idle sessions either way.
 */
export interface AgentSession {
  /** The agent's own identifier for this session, known after the first
   *  turn. Stored on the Project so the session can be reopened after
   *  `close()`. */
  readonly sessionId: string | null;

  /** Runs one turn. */
  send(input: TurnInput, limits: TurnLimits, signal: AbortSignal): AgentTurn;

  /** Releases any process the session holds. */
  close(): Promise<void>;
}

export interface TurnInput {
  text: string;
  attachments: Array<{ path: string; name: string; mime: string }>;
}

export interface TurnLimits {
  /** Maximum model calls in this turn. */
  maxSteps: number;
  /** Maximum spend for this turn, in US dollars. */
  maxBudgetUsd: number;
}

/** A named group of tools. The agent sees each one as `mcp__<name>__<tool>`. */
export interface ToolServerSpec {
  name: string;
  // A tool server holds tools with different input types; `any` erases that
  // difference the way an existential type would.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: ToolDef<any>[];
}

export interface ToolDef<TInput> {
  name: string;
  description: string;
  inputSchema: ZodType<TInput>;
  handler: (input: TInput) => Promise<ToolResult>;
}

export interface ToolResult {
  /** Text returned to the agent. */
  content: string;
  isError?: boolean;
}

/** A running turn. Consume `events` for progress and await `result` for the outcome. */
export interface AgentTurn {
  /** Progress, in order. Ends when the turn ends. */
  events: AsyncIterable<AgentEvent>;

  /** Resolves after `events` is exhausted. Failures arrive as
   *  `status: 'failed'` with an `error`. */
  result: Promise<TurnResult>;
}

export type AgentEvent =
  /** Agent text as it is produced. A driver without streaming emits one
   *  delta with the whole message. */
  | { kind: 'text_delta'; text: string }
  /** The agent called a tool, built-in or `cdk`. */
  | { kind: 'tool_start'; callId: string; name: string; input: unknown }
  | { kind: 'tool_end'; callId: string; ok: boolean; output?: unknown }
  /** Something the instructor should see, e.g. "starting a fresh chat". */
  | { kind: 'notice'; text: string };

export interface TurnResult {
  status: 'completed' | 'failed' | 'cancelled';
  /** The agent's session id after the turn. */
  sessionId: string | null;
  /** The agent's message for this turn, assembled by the driver. */
  text: string;
  error?: { code: string; message: string };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
    /** Model calls made in this turn. */
    steps?: number;
  };
}
