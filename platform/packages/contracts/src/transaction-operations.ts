export type TransactionOperationBucket =
  | 'NEEDS_DOCUMENTS'
  | 'NEEDS_PAYMENT'
  | 'NEEDS_CHEQUES'
  | 'NEEDS_CONTRACT'
  | 'NEEDS_BUYER_SIGNATURE'
  | 'NEEDS_COMPANY_EXECUTION'
  | 'READY_TO_COMPLETE';

export type TransactionOperationMilestoneCode =
  | 'BUYER_DOCUMENTS_COMPLETE'
  | 'DOWN_PAYMENT_RECEIVED'
  | 'CHEQUES_RECEIVED'
  | 'CONTRACT_GENERATED'
  | 'CONTRACT_SIGNED'
  | 'CONTRACT_STAMPED';

export interface TransactionOperationMilestoneSnapshot {
  code: TransactionOperationMilestoneCode;
  label: string;
  status: 'PENDING' | 'COMPLETED' | 'WAIVED' | 'BLOCKED';
}

export interface TransactionOperationQueueItemSnapshot {
  transactionId: string;
  buyerProfileId: string;
  buyerUserId: string;
  buyerDisplayName: string;
  unitTypeId: string;
  unitTypeCode: string;
  unitTypeName: string;
  transactionStatus: 'IN_PROGRESS' | 'READY_FOR_COMPLETION';
  completionPercent: string;
  openedAt: string;
  ageHours: number;
  bucket: TransactionOperationBucket;
  nextAction: string;
  pendingMilestoneCount: number;
  pendingMilestones: TransactionOperationMilestoneSnapshot[];
  contractDocumentId: string | null;
  missingRequiredSignerRoles: Array<'BUYER' | 'COMPANY' | 'WITNESS' | 'BROKER'>;
}

export interface TransactionOperationQueueSnapshot {
  generatedAt: string;
  counts: Record<TransactionOperationBucket, number>;
  items: TransactionOperationQueueItemSnapshot[];
}
