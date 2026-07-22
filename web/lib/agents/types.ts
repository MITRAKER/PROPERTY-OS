// Shared, transport-neutral types passed between the orchestrator and the
// specialist agents. Agents exchange structured JSON only; deterministic
// application code owns permissions, scoring, compliance blocks, and writes.

export type AgentName =
  | "orchestrator"
  | "follow_up"
  | "property_intelligence"
  | "outreach_compliance";

export type ModelRunLog = {
  agent: AgentName;
  provider: "claude" | "local_fallback";
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  fallbackCount?: number;
  summary?: string;
};

export type PropertyFacts = {
  id: string;
  address: string;
  ownerName: string;
  neighborhood?: string;
  ownershipYears?: number;
  lastContact?: string;
  followUpDate?: string | null;
  notes: string;
  signalLabels?: string[];
};

// Property Intelligence Agent output. It interprets evidence into signals and a
// recommended priority, but deterministic ranking code owns the final score.
export type PropertySignal = {
  type: string;
  value: string;
  source: string;
};

export type PropertyIntelligenceResult = {
  propertyId: string;
  signals: PropertySignal[];
  recommendedPriority: "high" | "medium" | "low";
  explanation: string;
};

// Outreach & Compliance Agent output. It never sends; approvalRequired is always
// true and a person must approve the draft before anyone acts on it.
export type OutreachChannel = "call" | "email" | "direct_mail" | "text";

export type ComplianceCheck = {
  name: string;
  passed: boolean;
  detail: string;
};

export type OutreachResult = {
  propertyId: string;
  channel: OutreachChannel;
  allowed: boolean;
  message: string;
  approvalRequired: true;
  complianceWarnings: string[];
  checks: ComplianceCheck[];
};

export type AgentTrace = {
  runs: ModelRunLog[];
};
