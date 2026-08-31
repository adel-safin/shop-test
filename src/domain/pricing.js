// Всё в копейках целыми числами: проценты от рублей с плавающей точкой
// разъезжаются с суммой в вебхуке.
export function applyPromocode(baseKopecks, promo) {
  if (!promo) return 0;

  const raw = promo.type === 'percent'
    ? Math.floor((baseKopecks * Number(promo.value)) / 100)
    : Number(promo.value);

  return Math.min(raw, baseKopecks);
}

export const toRubles = (kopecks) => Number(kopecks) / 100;
