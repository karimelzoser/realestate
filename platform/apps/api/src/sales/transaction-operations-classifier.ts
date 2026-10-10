import type {
  TransactionOperationBucket,
  TransactionOperationMilestoneSnapshot,
} from '@preneura/contracts/transaction-operations';

export type TransactionOperationSignerRole = 'BUYER' | 'COMPANY' | 'WITNESS' | 'BROKER';

export interface TransactionOperationClassificationInput {
  milestones: TransactionOperationMilestoneSnapshot[];
  contractDocumentId: string | null;
  missingSignerRoles: TransactionOperationSignerRole[];
}

export interface TransactionOperationClassification {
  bucket: TransactionOperationBucket;
  nextAction: string;
}

export function classifyTransactionOperation(
  input: TransactionOperationClassificationInput,
): TransactionOperationClassification {
  const byCode = new Map(input.milestones.map((milestone) => [milestone.code, milestone]));

  let bucket: TransactionOperationBucket;
  if (!isDone(byCode.get('BUYER_DOCUMENTS_COMPLETE'))) {
    bucket = 'NEEDS_DOCUMENTS';
  } else if (!isDone(byCode.get('DOWN_PAYMENT_RECEIVED'))) {
    bucket = 'NEEDS_PAYMENT';
  } else if (!isDone(byCode.get('CHEQUES_RECEIVED'))) {
    bucket = 'NEEDS_CHEQUES';
  } else if (!isDone(byCode.get('CONTRACT_GENERATED')) || !input.contractDocumentId) {
    bucket = 'NEEDS_CONTRACT';
  } else if (!isDone(byCode.get('CONTRACT_SIGNED'))) {
    bucket = input.missingSignerRoles.includes('BUYER')
      ? 'NEEDS_BUYER_SIGNATURE'
      : 'NEEDS_COMPANY_EXECUTION';
  } else if (!isDone(byCode.get('CONTRACT_STAMPED'))) {
    bucket = 'NEEDS_COMPANY_EXECUTION';
  } else {
    bucket = 'READY_TO_COMPLETE';
  }

  return {
    bucket,
    nextAction: nextAction(bucket, input.missingSignerRoles),
  };
}

function isDone(milestone: TransactionOperationMilestoneSnapshot | undefined): boolean {
  return Boolean(milestone && ['COMPLETED', 'WAIVED'].includes(milestone.status));
}

function nextAction(
  bucket: TransactionOperationBucket,
  missingSignerRoles: TransactionOperationSignerRole[],
): string {
  switch (bucket) {
    case 'NEEDS_DOCUMENTS':
      return 'Complete and verify required buyer documents.';
    case 'NEEDS_PAYMENT':
      return 'Record and verify the required down payment.';
    case 'NEEDS_CHEQUES':
      return 'Receive and verify the required cheque instruments.';
    case 'NEEDS_CONTRACT':
      return 'Generate or upload the current contract version.';
    case 'NEEDS_BUYER_SIGNATURE':
      return 'Obtain the buyer signature on the current contract.';
    case 'NEEDS_COMPANY_EXECUTION':
      return missingSignerRoles.length > 0
        ? `Complete required signatures: ${missingSignerRoles.join(', ')}.`
        : 'Complete company execution and stamp the contract.';
    case 'READY_TO_COMPLETE':
      return 'Review final evidence and complete the transaction.';
  }
}
