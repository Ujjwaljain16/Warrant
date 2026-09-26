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

  const currencyInfo = CURRENCIES[currency];
  if (!currencyInfo) {
    throw new RangeError(`unknown currency: ${currency}`);
  }

  const { symbol, decimals } = currencyInfo;
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);

  let whole, fractional;
  if (decimals === 0) {
    whole = absAmount;
    fractional = '';
  } else {
    whole = Math.floor(absAmount / Math.pow(10, decimals));
    fractional = (absAmount % Math.pow(10, decimals)).toString().padStart(decimals, '0');
  }

  const wholeFormatted = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let result = symbol + wholeFormatted;

  if (decimals > 0) {
    result += '.' + fractional;
  }

  if (isNegative) {
    result = '-' + result;
  }

  return result;
}

module.exports = { formatMoney };
