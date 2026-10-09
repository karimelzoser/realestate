export type BuyerPropertyState = 'PURCHASE_IN_PROGRESS' | 'PROPERTY_ACTIVE';
export type BuyerInstallmentStatus =
  | 'UPCOMING'
  | 'DUE'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'OVERDUE'
  | 'WAIVED'
  | 'CANCELLED';

export interface BuyerPropertyInstallmentSnapshot {
  paymentItemId: string;
  sequenceNumber: number;
  itemType: 'DOWN_PAYMENT' | 'INSTALLMENT' | 'FEE';
  amount: string;
  paidAmount: string;
  remainingAmount: string;
  dueAt: string;
  status: BuyerInstallmentStatus;
  paidAt: string | null;
}

export interface BuyerPropertyContractSnapshot {
  executionSnapshotId: string;
  executed: true;
  documentSha256Hex: string;
  objectTrustStatus: 'CLEAN' | 'LEGACY_UNSCANNED';
  templateVersionNumber: number;
  manifestSha256Hex: string;
  executedAt: string;
}

export interface BuyerPropertyFinanceSnapshot {
  scheduleId: string;
  scheduleStatus: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  currency: string;
  totalContractAmount: string;
  paidTowardContract: string;
  remainingContractAmount: string;
  overdueAmount: string;
  overdueItemCount: number;
  nextDueAt: string | null;
  nextDueAmount: string | null;
  installments: BuyerPropertyInstallmentSnapshot[];
}

export interface BuyerPropertySnapshot {
  transactionId: string;
  reservationId: string;
  state: BuyerPropertyState;
  transactionStatus: 'IN_PROGRESS' | 'READY_FOR_COMPLETION' | 'COMPLETED';
  projectId: string;
  projectName: string;
  unitTypeId: string;
  unitTypeCode: string;
  unitTypeName: string;
  quotedTotal: string | null;
  currency: string;
  completionPercent: string;
  openedAt: string;
  completedAt: string | null;
  contract: BuyerPropertyContractSnapshot | null;
  finance: BuyerPropertyFinanceSnapshot | null;
}

export interface BuyerPropertyPortfolioSnapshot {
  tenantId: string;
  projectId: string;
  buyerUserId: string;
  generatedAt: string;
  properties: BuyerPropertySnapshot[];
}
