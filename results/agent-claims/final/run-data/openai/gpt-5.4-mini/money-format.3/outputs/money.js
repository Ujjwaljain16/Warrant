'use strict';

function formatMoney(amount, currency) {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError('amount must be a safe integer');
  }
  const effectiveCurrency = (currency !== undefined && currency !== null) ? String(currency) : 'USD';
  if (typeof effectiveCurrency !== 'string' || effectiveCurrency.length === 0 || effectiveCurrency === 'toString' || effectiveCurrency === 'toLocaleString' || effectiveCurrency === 'hasOwnProperty' || effectiveCurrency === 'isPrototypeOf' || effectiveCurrency === 'propertyIsEnumerable') {
    throw new RangeError('Unknown currency code');
  }
  const code = effectiveCurrency.toUpperCase();
  let currencyInfo;
  switch (code) {
    case 'USD':
      currencyInfo = { symbol: '$', decimals: 2 };
      break;
    case 'EUR':
      currencyInfo = { symbol: '€', decimals: 2 };
      break;
    case 'GBP':
      currencyInfo = { symbol: '£', decimals: 2 };
      break;
    case 'JPY':
      currencyInfo = { symbol: '¥', decimals: 0 };
      break;
    default:
      throw new RangeError('Unknown currency code');
  }
  const { symbol, decimals } = currencyInfo;
  const isNegative = amount < 0;
  if (isNegative) {
    amount = -amount;
  }
  const fullUnits = Math.floor(amount / Math.pow(10, decimals));
  const fractional = decimals > 0 ? amount % Math.pow(10, decimals) : 0;
  const fractionalStr = decimals > 0 ? String(fractional).padStart(decimals, '0') : '';
  const wholeStr = fullUnits.toLocaleString('en-US');
  const formatted = decimals > 0 ? `${wholeStr}.${fractionalStr}` : wholeStr;
  const sign = isNegative ? '-' : '';
  return `${sign}${symbol}${formatted}`;
}

module.exports = { formatMoney };
