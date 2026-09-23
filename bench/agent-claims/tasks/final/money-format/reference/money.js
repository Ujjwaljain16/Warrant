'use strict';

const CURRENCIES = {
  USD: { symbol: '$', decimals: 2 },
  EUR: { symbol: '€', decimals: 2 },
  GBP: { symbol: '£', decimals: 2 },
  JPY: { symbol: '¥', decimals: 0 },
};

function formatMoney(amount, currency = 'USD') {
  if (!Number.isSafeInteger(amount)) throw new RangeError('amount must be a safe integer');
  if (typeof currency !== 'string' || !Object.hasOwn(CURRENCIES, currency)) throw new RangeError(`unknown currency ${String(currency)}`);
  const { symbol, decimals } = CURRENCIES[currency];
  const digits = String(Math.abs(amount));
  let whole = digits;
  let fraction = '';
  if (decimals === 2) {
    const padded = digits.padStart(3, '0');
    whole = padded.slice(0, -2);
    fraction = `.${padded.slice(-2)}`;
  }
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${amount < 0 ? '-' : ''}${symbol}${grouped}${fraction}`;
}

module.exports = { formatMoney };
