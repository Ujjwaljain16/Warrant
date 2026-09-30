'use strict';

const CURRENCIES = {
  USD: { symbol: '$', decimals: 2 },
  EUR: { symbol: '€', decimals: 2 },
  GBP: { symbol: '£', decimals: 2 },
  JPY: { symbol: '¥', decimals: 0 },
};

function formatMoney(amount, currency = 'USD') {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError('Amount must be a safe integer');
  }

  if (typeof currency !== 'string' || !Object.hasOwn(CURRENCIES, currency)) {
    throw new RangeError('Unknown currency code');
  }

  const { symbol, decimals } = CURRENCIES[currency];

  const isNegative = amount < 0;
  const absStr = String(Math.abs(amount));

  let wholePart = '';
  let fracPart = '';

  if (decimals === 0) {
    wholePart = absStr;
  } else {
    const padded = absStr.padStart(decimals + 1, '0');
    wholePart = padded.slice(0, -decimals);
    fracPart = padded.slice(-decimals);
  }

  let formattedWhole = '';
  for (let i = wholePart.length - 1, count = 0; i >= 0; i--, count++) {
    if (count > 0 && count % 3 === 0) {
      formattedWhole = ',' + formattedWhole;
    }
    formattedWhole = wholePart[i] + formattedWhole;
  }

  const signStr = isNegative ? '-' : '';
  const result = `${signStr}${symbol}${formattedWhole}${decimals > 0 ? '.' + fracPart : ''}`;

  return result;
}

module.exports = { formatMoney };
