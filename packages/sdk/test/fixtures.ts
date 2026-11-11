/**
 * Invented fixtures. Never paste live API responses here: no real ids, names,
 * IBANs or amounts. The IBAN is the published German test IBAN.
 */
export const account = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'ACME GmbH',
  currency: 'EUR',
  state: 'active',
  balance: { available: '1234.56', pending: null },
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
  id: '00000000-0000-4000-8000-000000000101',
  group_id: 'group-1',
  account_id: account.id,
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
  card: { id: '00000000-0000-4000-8000-000000000201', last_4: '4242' },
  network_transaction_id: null,
};

export const card = {
  id: '00000000-0000-4000-8000-000000000201',
  last_4: '4242',
  name: 'ACME Travel',
  type: 'virtual',
  state: 'active',
  account_id: account.id,
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
