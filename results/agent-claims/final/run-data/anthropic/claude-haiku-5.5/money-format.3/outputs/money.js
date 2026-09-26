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

  if (!Object.prototype.hasOwnProperty.call(CURRENCIES, currency)) {
    throw new RangeError('unknown currency');
  }

  const { symbol, decimals } = CURRENCIES[currency];
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);

  let formatted;
  if (decimals === 0) {
    formatted = String(absAmount);
  } else {
    const divisor = Math.pow(10, decimals);
    const whole = Math.floor(absAmount / divisor);
    const fraction = absAmount % divisor;
    formatted = whole + '.' + String(fraction).padStart(decimals, '0');
  }

  const parts = formatted.split('.');
  const wholeStr = parts[0];
  const fractionalStr = parts[1] || '';

  const withCommas = wholeStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const result = fractionalStr ? withCommas + '.' + fractionalStr : withCommas;

  return (isNegative ? '-' : '') + symbol + result;
}

module.exports = { formatMoney };
