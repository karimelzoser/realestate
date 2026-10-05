export type PricingComponent = 'INDOOR' | 'ROOF' | 'GARDEN';

export interface ReservationPriceComponentSnapshot {
  component: PricingComponent;
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
