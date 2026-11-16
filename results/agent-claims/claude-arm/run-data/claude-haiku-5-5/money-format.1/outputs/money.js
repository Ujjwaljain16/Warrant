'use strict';

// Currency code -> { symbol, decimals }. `decimals` is the number of minor-unit
// digits the amount carries (USD/EUR/GBP amounts are in cents/pence, JPY in yen).
const CURRENCIES = new Map([
  ['USD', { symbol: '$', decimals: 2 }],
  ['EUR', { symbol: '€', decimals: 2 }],
  ['GBP', { symbol: '£', decimals: 2 }],
  ['JPY', { symbol: '¥', decimals: 0 }],
]);

function groupThousands(digits) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatMoney(amount, currency = 'USD') {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError('amount must be a safe integer');
  }
  const info = CURRENCIES.get(currency);
  if (info === undefined) {
    throw new RangeError(`unknown currency code: ${String(currency)}`);
  }

  const negative = amount < 0;
  // Math.abs and String are exact for safe integers, so no float division is needed.
  const digits = String(Math.abs(amount));

  let whole;
  let body;
  if (info.decimals === 0) {
    whole = digits;
    body = groupThousands(whole);
  } else {
    const padded = digits.padStart(info.decimals + 1, '0');
    whole = padded.slice(0, padded.length - info.decimals);
    const fraction = padded.slice(padded.length - info.decimals);
    body = `${groupThousands(whole)}.${fraction}`;
  }

  return `${negative ? '-' : ''}${info.symbol}${body}`;
}

module.exports = { formatMoney };
