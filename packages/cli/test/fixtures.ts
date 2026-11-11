/**
 * Invented fixtures. Never paste live API responses here: no real ids, names,
 * IBANs or amounts. The IBAN is the published German test IBAN.
 */
export const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
export const TRANSACTION_ID = '00000000-0000-4000-8000-000000000101';
export const CARD_ID = '00000000-0000-4000-8000-000000000201';

export const account = {
  id: ACCOUNT_ID,
  name: 'ACME GmbH',
  currency: 'EUR',
  state: 'active',
  balance: { available: '1234.56', pending: '10.00' },
  account_details: [
    {
      iban: 'DE89370400440532013000',
      bic: 'COBADEFFXXX',
      holder_name: 'ACME GmbH',
      bank_name: 'Test Bank',
      type: 'local',
    },
  ],
  created_at: '2025-01-01T09:00:00Z',
};

export const transaction = {
  id: TRANSACTION_ID,
  group_id: 'group-1',
  account_id: ACCOUNT_ID,
  account_type: 'current',
  type: 'card_payment',
  state: 'completed',
  amount: '-12.50',
  currency: 'EUR',
  original_amount: '-13.00',
  original_currency: 'USD',
  show_at: '2025-03-01T09:00:00Z',
  created_at: '2025-03-01T09:00:01Z',
  updated_at: '2025-03-02T10:00:00Z',
  merchant: {
    name: 'ACME CLOUD',
    category_code: '5734',
    city: 'Berlin',
    country: 'DE',
  },
  card: { id: CARD_ID, last_4: '4242' },
  network_transaction_id: null,
};

export const card = {
  id: CARD_ID,
  last_4: '4242',
  name: 'ACME Travel',
  type: 'virtual',
  state: 'active',
  account_id: ACCOUNT_ID,
  limits: [
    {
      type: 'spending',
      renewal: 'monthly',
      size: '1000.00',
      used: '12.50',
      currency: 'EUR',
    },
  ],
  limits_visible: true,
};
