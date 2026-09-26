'use strict';

const CURRENCIES = {
  USD: { symbol: '$', decimals: 2 },
  EUR: { symbol: '€', decimals: 2 },
  GBP: { symbol: '£', decimals: 2 },
  JPY: { symbol: '¥', decimals: 0 }
};

function formatMoney(amount, currency = 'USD') {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError('amount must be a safe integer');
  }

  if (!CURRENCIES.hasOwnProperty(currency)) {
    throw new RangeError(`unknown currency: ${currency}`);
  }

  const { symbol, decimals } = CURRENCIES[currency];
  const isNegative = amount < 0;
  const absoluteAmount = Math.abs(amount);

  let wholePart;
  let fractionalPart = '';

  if (decimals === 0) {
    wholePart = absoluteAmount;
  } else {
    const divisor = Math.pow(10, decimals);
    wholePart = Math.floor(absoluteAmount / divisor);
    const remainder = absoluteAmount % divisor;
    fractionalPart = String(remainder).padStart(decimals, '0');
  }

  const formattedWhole = String(wholePart).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  let result = symbol + formattedWhole;
  if (decimals > 0) {
    result += '.' + fractionalPart;
  }

  if (isNegative) {
    result = '-' + result;
  }

  return result;
}

module.exports = { formatMoney };
