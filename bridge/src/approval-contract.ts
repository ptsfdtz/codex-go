import { validateContract } from './contracts.js';
import { invariant } from './errors.js';

export const APPROVAL_METHODS: Record<string, string> = {
  'item/commandExecution/requestApproval': 'CommandExecutionRequestApproval',
  'item/fileChange/requestApproval': 'FileChangeRequestApproval',
  'item/permissions/requestApproval': 'PermissionsRequestApproval',
};
export type ApprovalDecision = 'approve' | 'reject' | 'cancel';
export function approvalChoices(method: string, context: unknown): ApprovalDecision[] {
  invariant(
    APPROVAL_METHODS[method],
    'UPSTREAM_UNSUPPORTED_REQUEST',
    'Unsupported approval method',
  );
  if (method === 'item/permissions/requestApproval') return ['approve', 'reject', 'cancel'];
  const advertised = (context as { availableDecisions?: unknown }).availableDecisions;
  if (advertised === undefined) return ['approve', 'reject', 'cancel'];
  invariant(
    Array.isArray(advertised) && advertised.length > 0 && advertised.length <= 16,
    'UPSTREAM_PROTOCOL_ERROR',
    'Invalid available approval decisions',
  );
  for (const value of advertised)
    validateContract(`${APPROVAL_METHODS[method]}Response`, { decision: value });
  invariant(
    advertised.includes('decline') || advertised.includes('cancel'),
    'UPSTREAM_UNSUPPORTED_REQUEST',
    'Approval request has no supported denial',
  );
  const choices: ApprovalDecision[] = [];
  if (advertised.includes('accept')) choices.push('approve');
  choices.push('reject');
  if (advertised.includes('cancel')) choices.push('cancel');
  return choices;
}
export function commandDecision(
  method: string,
  decision: ApprovalDecision,
  context: unknown,
): object {
  invariant(
    approvalChoices(method, context).includes(decision),
    'UPSTREAM_UNSUPPORTED_REQUEST',
    'Requested decision is unavailable',
  );
  const advertised = (context as { availableDecisions?: unknown[] }).availableDecisions;
  return {
    decision:
      decision === 'approve'
        ? 'accept'
        : decision === 'cancel'
          ? 'cancel'
          : !advertised || advertised.includes('decline')
            ? 'decline'
            : 'cancel',
  };
}
