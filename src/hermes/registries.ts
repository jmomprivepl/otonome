import type { HermesSopDefinition, RouteDecision, SubAgentDescriptor } from '@/types/hermesOrchestration';

export const SOP_REGISTRY: Record<string, HermesSopDefinition> = {
  contract_analysis: {
    id: 'contract_analysis',
    title: 'Contract Analysis',
    steps: [
      { id: 's1', label: 'Identify parties & governing law' },
      { id: 's2', label: 'Extract key dates & termination' },
      { id: 's3', label: 'Flag high-risk clauses' },
      { id: 's4', label: 'Summarize obligations & next steps' },
    ],
  },
  incident_response: {
    id: 'incident_response',
    title: 'Incident Response',
    steps: [
      { id: 'i1', label: 'Triage severity & scope' },
      { id: 'i2', label: 'Containment checklist' },
      { id: 'i3', label: 'Stakeholder notification draft' },
    ],
  },
};

export const AGENT_REGISTRY: SubAgentDescriptor[] = [
  {
    id: 'financial',
    name: 'Financial Analyst',
    domainTags: ['Financial', 'FP&A'],
    systemPreamble:
      'You are a financial specialist. Be concise; state assumptions explicitly. Focus on cash flow, runway, and material risks.',
  },
  {
    id: 'security',
    name: 'Security Reviewer',
    domainTags: ['Security'],
    systemPreamble:
      'You are a security specialist. Prioritize threats, controls, and concrete remediation steps.',
  },
];

/** Keyword stub — replace with router vector / classifier when wired. */
export function routeIntent(userPrompt: string): RouteDecision {
  const p = userPrompt.toLowerCase();
  if (/\bcontract\b|\bnda\b|\bmssa\b|\blegal review\b/.test(p)) {
    return { kind: 'sop', sopId: 'contract_analysis' };
  }
  if (/\bincident\b|\boutage\b|\bsev[ -]?[0-9]\b/.test(p)) {
    return { kind: 'sop', sopId: 'incident_response' };
  }
  if (/\bfinance\b|\bfinancial\b|\bbudget\b|\brunway\b|\bvaluation\b/.test(p)) {
    return { kind: 'sub_agent', agentId: 'financial' };
  }
  if (/\bvulnerability\b|\bpen.?test\b|\bsoc\b|\breach\b/.test(p)) {
    return { kind: 'sub_agent', agentId: 'security' };
  }
  return { kind: 'direct' };
}

export function getSubAgent(id: string): SubAgentDescriptor | undefined {
  return AGENT_REGISTRY.find((a) => a.id === id);
}
