export interface MessageEnvelope<TPayload> {
  messageId: string;
  messageType: string;
  messageVersion: number;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  producer: string;
  occurredAt: string;
  payload: TPayload;
}

export type MessageMetadata = Omit<MessageEnvelope<never>, 'payload'>;

/** Business-specific payloads are added only by their owning implementation stage. */
export const messageEnvelope = <TPayload>(
  metadata: MessageMetadata,
  payload: TPayload,
): MessageEnvelope<TPayload> => ({ ...metadata, payload });

export interface IdentityUserRegisteredV1 {
  userId: string;
  role: 'CUSTOMER' | 'ADMIN';
}
export interface AccountCustomerCreatedV1 {
  customerId: string;
  userId: string;
}
export interface AccountCreatedV1 {
  accountId: string;
  customerId: string;
  currency: 'EUR' | 'USD' | 'SEK';
  status: 'ACTIVE';
}
export interface AccountStatusChangedV1 {
  accountId: string;
  previousStatus: AccountStatus;
  status: AccountStatus;
}
export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

export type PaymentStatus =
  | 'CREATED'
  | 'VALIDATING'
  | 'RESERVING_FUNDS'
  | 'AUTHORIZED'
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'SETTLED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'FAILED'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED'
  | 'REVERSED';

export interface PaymentCreatedV1 {
  paymentId: string;
  sourceLedgerAccountId: string;
  destinationLedgerAccountId: string;
  amountMinor: string;
  currency: 'EUR' | 'USD' | 'SEK';
  kind: 'INTERNAL_TRANSFER' | 'RAIL_TRANSFER';
}
export interface LedgerReserveFundsV1 {
  paymentId: string;
  sourceLedgerAccountId: string;
  amountMinor: string;
  currency: 'EUR' | 'USD' | 'SEK';
  idempotencyKey: string;
}
export interface LedgerFundsReservedV1 {
  paymentId: string;
  reservationId: string;
  sourceLedgerAccountId: string;
  amountMinor: string;
  currency: 'EUR' | 'USD' | 'SEK';
}
export interface LedgerReleaseFundsV1 {
  paymentId: string;
  reservationId: string;
  idempotencyKey: string;
}
export interface LedgerPostInternalTransferV1 {
  paymentId: string;
  reservationId: string;
  sourceLedgerAccountId: string;
  destinationLedgerAccountId: string;
  amountMinor: string;
  currency: 'EUR' | 'USD' | 'SEK';
  idempotencyKey: string;
}
export interface LedgerInternalTransferPostedV1 {
  paymentId: string;
  transactionId: string;
  reservationId: string;
}
export interface LedgerFundsReleasedV1 {
  paymentId: string;
  reservationId: string;
}

export type RailScenario =
  | 'SUCCESS'
  | 'TEMPORARY_FAILURE'
  | 'PERMANENT_REJECTION'
  | 'TIMEOUT_AFTER_ACCEPTANCE'
  | 'DUPLICATE_EVENTS'
  | 'OUT_OF_ORDER_EVENTS';
export interface RailSubmitPaymentV1 {
  paymentId: string;
  amountMinor: string;
  currency: 'EUR' | 'USD' | 'SEK';
  scenario: RailScenario;
}
export interface RailPaymentAcceptedV1 {
  paymentId: string;
  railReference: string;
}
export interface RailPaymentSettledV1 {
  paymentId: string;
  railReference: string;
}
export interface RailPaymentRejectedV1 {
  paymentId: string;
  railReference: string;
  reason: string;
}
export interface RailPaymentTimedOutV1 {
  paymentId: string;
  railReference: string;
}
export interface RailPaymentTemporarilyFailedV1 {
  paymentId: string;
  railReference: string;
  attempt: number;
  retryAfterMs: number;
}
export interface RailSettlementFileGeneratedV1 {
  fileReference: string;
  rows: Array<{
    externalReference: string;
    expectedMinor: string;
    actualMinor: string;
    currency: 'EUR' | 'USD' | 'SEK';
  }>;
}
export interface LedgerPostSettlementV1 {
  paymentId: string;
  reservationId: string;
  sourceLedgerAccountId: string;
  destinationLedgerAccountId: string;
  amountMinor: string;
  currency: 'EUR' | 'USD' | 'SEK';
  idempotencyKey: string;
}
export interface LedgerSettlementPostedV1 {
  paymentId: string;
  transactionId: string;
  reservationId: string;
}
export interface LedgerPostAdjustmentV1 {
  adjustmentId: string;
  paymentId: string;
  originalTransactionId: string;
  sourceLedgerAccountId: string;
  destinationLedgerAccountId: string;
  amountMinor: string;
  currency: 'EUR' | 'USD' | 'SEK';
  action: 'REFUND' | 'REVERSAL';
  idempotencyKey: string;
}
export interface LedgerAdjustmentPostedV1 {
  adjustmentId: string;
  paymentId: string;
  transactionId: string;
  amountMinor: string;
  action: 'REFUND' | 'REVERSAL';
}
