export const STATUS = {
  created: 'created',
  paid: 'paid',
  delivering: 'delivering',
  delivered: 'delivered',
  paymentFailed: 'payment_failed',
  outOfStock: 'out_of_stock',
  deliveryFailed: 'delivery_failed',
};

export const FINAL_STATUSES = new Set([STATUS.delivered, STATUS.paymentFailed]);

export const RECOVERABLE_STATUSES = new Set([STATUS.outOfStock, STATUS.deliveryFailed]);

const ALLOWED = {
  [STATUS.created]: new Set([STATUS.paid, STATUS.paymentFailed]),
  [STATUS.paid]: new Set([STATUS.delivering]),
  [STATUS.delivering]: new Set([STATUS.delivered, STATUS.outOfStock, STATUS.deliveryFailed]),
  [STATUS.outOfStock]: new Set([STATUS.delivering]),
  [STATUS.deliveryFailed]: new Set([STATUS.delivering]),
  [STATUS.delivered]: new Set(),
  [STATUS.paymentFailed]: new Set(),
};

export const canTransition = (from, to) => ALLOWED[from]?.has(to) === true;

export const isFinal = (status) => FINAL_STATUSES.has(status);
