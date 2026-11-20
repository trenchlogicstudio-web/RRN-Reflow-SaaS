// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// Prices are stored as integer minor units (cents) and never as floats.

export const CURRENCIES = [
  'EUR', 'USD', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'ISK', 'PLN', 'CZK', 'HUF', 'RON',
  'RSD', 'BAM', 'MKD', 'ALL', 'TRY', 'UAH', 'AED', 'ILS', 'ZAR', 'AUD', 'NZD', 'CAD', 'MXN', 'BRL', 'SGD', 'JPY',
];

/** '40' · '40.5' · '40,50' · '1 200,00' → cents, or null if not a valid price. */
export function parseMoney(value) {
  let s = String(value ?? '').trim().replace(/[\s']/g, '');
  if (!s) return null;
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); // 1.200,50
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) s = s.replace(/,/g, ''); // 1,200.50
  else s = s.replace(',', '.');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** 4050 → '40.50' for form fields. */
export function centsToInput(cents) {
  return (cents / 100).toFixed(2);
}
