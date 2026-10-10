import type { TransactionOperationBucket } from './transaction-operations.js';

export interface ManagementProjectOverviewSnapshot {
  generatedAt: string;
  tenantId: string;
  projectId: string;
  currency: string;
  inventory: {
    unitTypes: number;
    available: number;
    reserved: number;
    sold: number;
    withdrawn: number;
    scheduledPriceVersions: number;
    nextPriceChangeAt: string | null;
  };
  allocation: {
    waiting: number;
    called: number;
    locked: number;
  };
  transactions: {
    open: number;
    readyForCompletion: number;
    completed: number;
    cancelled: number;
    averageCompletionPercent: string;
    oldestOpenHours: number | null;
  };
  completionBacklog: Record<TransactionOperationBucket, number>;
  finance: {
    overdueItems: number;
    overdueOutstandingAmount: string;
  };
  commissions: {
    pendingPrerequisites: number;
    eligible: number;
    invoiced: number;
    due: number;
    paid: number;
    disputed: number;
    overdue: number;
    outstandingAmount: string;
  };
  refunds: {
    requested: number;
    approved: number;
    approvedAmount: string;
  };
  notifications: {
    pending: number;
    failed: number;
  };
}
