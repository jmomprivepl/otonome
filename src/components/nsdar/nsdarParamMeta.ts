/** APQC Domains = params 1–13 (`v[0]`..`v[12]`). Operational = 14–27 (`v[13]`..`v[26]`). Future = 28–32 (`v[27]`..`v[31]`). */
export type NsdarParamGroup = 'apqc' | 'ops' | 'future';

export type NsdarParamMeta = {
  index: number;
  paramNumber: number;
  shortLabel: string;
  tooltip: string;
  group: NsdarParamGroup;
};

export const NSDAR_PARAM_META: NsdarParamMeta[] = [
  { index: 0, paramNumber: 1, shortLabel: 'Vision&Strategy', tooltip: 'Strategy, vision, mission, goals, corporate direction…', group: 'apqc' },
  { index: 1, paramNumber: 2, shortLabel: 'ProductDev', tooltip: 'Product development, R&D, design, engineering delivery…', group: 'apqc' },
  { index: 2, paramNumber: 3, shortLabel: 'Market&Sell', tooltip: 'Marketing, sales, go-to-market, campaigns, pipeline…', group: 'apqc' },
  { index: 3, paramNumber: 4, shortLabel: 'SupplyChain', tooltip: 'Sourcing, logistics, inventory, procurement, distribution…', group: 'apqc' },
  { index: 4, paramNumber: 5, shortLabel: 'ServiceDelivery', tooltip: 'Delivery operations, fulfillment, service execution…', group: 'apqc' },
  { index: 5, paramNumber: 6, shortLabel: 'CustomerService', tooltip: 'Support, tickets, CSAT, retention, customer care…', group: 'apqc' },
  { index: 6, paramNumber: 7, shortLabel: 'HumanCapital', tooltip: 'HR, hiring, talent, payroll, learning, org development…', group: 'apqc' },
  { index: 7, paramNumber: 8, shortLabel: 'IT', tooltip: 'Information technology, systems, infrastructure, apps…', group: 'apqc' },
  { index: 8, paramNumber: 9, shortLabel: 'Finance', tooltip: 'Budget, accounting, revenue, forecasting, treasury…', group: 'apqc' },
  { index: 9, paramNumber: 10, shortLabel: 'Assets', tooltip: 'Physical / digital assets, facilities, capital, maintenance…', group: 'apqc' },
  { index: 10, paramNumber: 11, shortLabel: 'Risk&Compliance', tooltip: 'Risk, audit, policy, regulation, legal & compliance…', group: 'apqc' },
  { index: 11, paramNumber: 12, shortLabel: 'ExternalRelations', tooltip: 'PR, government relations, partnerships, community…', group: 'apqc' },
  { index: 12, paramNumber: 13, shortLabel: 'BusinessCapabilities', tooltip: 'Enterprise capabilities, process maturity, transformation…', group: 'apqc' },
  { index: 13, paramNumber: 14, shortLabel: 'Urgency', tooltip: 'Time sensitivity, deadlines, ASAP, critical path…', group: 'ops' },
  { index: 14, paramNumber: 15, shortLabel: 'Privacy', tooltip: 'PII, confidentiality, data protection, anonymization…', group: 'ops' },
  { index: 15, paramNumber: 16, shortLabel: 'RiskLevel', tooltip: 'Operational or decision risk, exposure, mitigation…', group: 'ops' },
  { index: 16, paramNumber: 17, shortLabel: 'Sentiment', tooltip: 'Tone, emotion, stakeholder attitude, morale…', group: 'ops' },
  { index: 17, paramNumber: 18, shortLabel: 'Complexity', tooltip: 'Depth, multi-step reasoning, interdependencies…', group: 'ops' },
  { index: 18, paramNumber: 19, shortLabel: 'Knowledge', tooltip: 'Domain expertise, facts, documentation, know-how…', group: 'ops' },
  { index: 19, paramNumber: 20, shortLabel: 'Authority', tooltip: 'Decision rights, approval, delegation, mandate…', group: 'ops' },
  { index: 20, paramNumber: 21, shortLabel: 'Format', tooltip: 'Output shape: prose, table, list, JSON, slides…', group: 'ops' },
  { index: 21, paramNumber: 22, shortLabel: 'Verification', tooltip: 'Checks, proof, citations, validation, test criteria…', group: 'ops' },
  { index: 22, paramNumber: 23, shortLabel: 'Language', tooltip: 'Locale, translation, multilingual, terminology…', group: 'ops' },
  { index: 23, paramNumber: 24, shortLabel: 'History', tooltip: 'Prior context, chat history, continuity, memory…', group: 'ops' },
  { index: 24, paramNumber: 25, shortLabel: 'Ambiguity', tooltip: 'Unclear requirements, open interpretation, gaps…', group: 'ops' },
  { index: 25, paramNumber: 26, shortLabel: 'Stability', tooltip: 'Change rate, volatility, need for steady vs evolving answer…', group: 'ops' },
  { index: 26, paramNumber: 27, shortLabel: 'Iteration', tooltip: 'Refinement loops, versions, feedback cycles…', group: 'ops' },
  { index: 27, paramNumber: 28, shortLabel: 'Future feature 1', tooltip: 'Reserved for future routing / NSDAR adapter slot.', group: 'future' },
  { index: 28, paramNumber: 29, shortLabel: 'Future feature 2', tooltip: 'Reserved for future routing / NSDAR adapter slot.', group: 'future' },
  { index: 29, paramNumber: 30, shortLabel: 'Future feature 3', tooltip: 'Reserved for future routing / NSDAR adapter slot.', group: 'future' },
  { index: 30, paramNumber: 31, shortLabel: 'Future feature 4', tooltip: 'Reserved for future routing / NSDAR adapter slot.', group: 'future' },
  { index: 31, paramNumber: 32, shortLabel: 'Future feature 5', tooltip: 'Reserved for future routing / NSDAR adapter slot.', group: 'future' },
];
