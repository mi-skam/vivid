import type { Account, Card, Vivid } from '@genz-its/vivid-sdk';
import { consola } from 'consola';
import { isUuid } from './arguments';
import { fetchAll } from './pagination';

/**
 * Accounts and cards can be addressed by name as well as by ID. A UUID is used
 * as is, without a request. Anything else is matched case-insensitively
 * against the visible objects: account `name`, card `name` or the card's last
 * four digits. Exactly one match is required; no match or several matches
 * exit with a list of what is available, since guessing would show the wrong
 * account's data.
 */
function pickOne<T extends { id: string }>(
  kind: string,
  target: string,
  items: T[],
  keys: (item: T) => Array<string | null>,
  label: (item: T) => string,
): T {
  const wanted = target.trim().toLowerCase();
  const matches = items.filter((item) =>
    keys(item).some((key) => key !== null && key.toLowerCase() === wanted),
  );
  if (matches.length === 1) {
    return matches[0] as T;
  }
  if (matches.length === 0) {
    const available = items.map(label).join(', ') || 'none';
    consola.error(`No ${kind} named "${target}". Available: ${available}.`);
  } else {
    const candidates = matches.map((item) => `${label(item)} (${item.id})`);
    consola.error(
      `"${target}" matches ${matches.length} ${kind}s: ${candidates.join(', ')}. Pass the ID instead.`,
    );
  }
  process.exit(1);
}

const accountLabel = (account: Account) => account.name || account.id;
const cardLabel = (card: Card) =>
  `${card.name || card.id}${card.last_4 ? ` (…${card.last_4})` : ''}`;

/** Resolves account IDs or names; the account list is fetched at most once. */
export async function resolveAccountIds(
  client: Vivid,
  targets: string[],
): Promise<string[]> {
  let accounts: Account[] | undefined;
  const ids: string[] = [];
  for (const target of targets) {
    if (isUuid(target)) {
      ids.push(target.trim());
      continue;
    }
    accounts ??= await client.accounts.list({ includeClosed: true });
    ids.push(
      pickOne('account', target, accounts, (a) => [a.name], accountLabel).id,
    );
  }
  return ids;
}

/** Resolves a single account ID or name. */
export async function resolveAccountId(
  client: Vivid,
  target: string,
): Promise<string> {
  const [id] = await resolveAccountIds(client, [target]);
  return id as string;
}

/** Resolves a card ID, card name or the card's last four digits. */
export async function resolveCardId(
  client: Vivid,
  target: string,
): Promise<string> {
  if (isUuid(target)) {
    return target.trim();
  }
  const cards = await fetchAll(async (page) => {
    const response = await client.cards.list(page);
    return { items: response.cards, nextCursor: response.next_cursor };
  });
  return pickOne(
    'card',
    target,
    cards,
    (card) => [card.name, card.last_4],
    cardLabel,
  ).id;
}
