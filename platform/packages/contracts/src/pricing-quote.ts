export type QuotePricingComponent = 'INDOOR' | 'ROOF' | 'GARDEN';

export interface ReservationPriceComponentSnapshot {
  component: QuotePricingComponent;
  areaSqm: string;
  ratePerSqm: string;
  amount: string;
}

export interface TransactionPriceSnapshot {
  transactionId: string;
  reservationId: string;
  unitTypeId: string;
  unitTypeCode: string;
  unitTypeName: string;
  pricingVersionId: string;
  pricingVersionNumber: number;
  pricingVersionLabel: string;
  pricingEffectiveAt: string;
  quotedTotal: string;
  currency: string;
  reservedAt: string;
  components: ReservationPriceComponentSnapshot[];
}
