import type { Amount, CursorListOptions, CursorPage, OpenEnum } from '../types';
import { BaseResource } from './base';

/** One cap on what a card may spend, in the limit's own currency. */
export interface CardLimit {
  type: OpenEnum<'spending' | 'withdrawal' | 'single_operation'>;
  /**
   * `none` means it is only ever reset by hand; `null` for a limit that is
   * never replenished, usually a single-operation cap.
   */
  renewal: OpenEnum<'monthly' | 'weekly' | 'daily' | 'none'> | null;
  size: Amount;
  /** `null` when the limit tracks no usage; `"0.00"` when nothing is spent yet. */
  used: Amount | null;
  /** ISO 4217. */
  currency: string;
}

/** One card. Closed cards are never returned. */
export interface Card {
  /** UUID; the same value appears as `card.id` on transactions. */
  id: string;
  /** `null` when the card number is not known yet. */
  last_4: string | null;
  /** The name given in the app, `""` when unnamed. */
  name: string;
  type: OpenEnum<'virtual' | 'physical'>;
  /** A physical card on its way to the holder currently reads as an unknown value. */
  state: OpenEnum<'active' | 'frozen' | 'blocked'>;
  /** `null` when the card is not linked to an account the issuer may see. */
  account_id: string | null;
  /** Active limits; also empty when `limits_visible` is `false`. */
  limits: CardLimit[];
  /** `false` when the key's issuer may not see card limits in the app. */
  limits_visible: boolean;
}

export interface ListCardsResponse extends CursorPage {
  cards: Card[];
}

export class CardsResource extends BaseResource {
  /** Retrieves one page of cards via `POST /api/v1/cards/list`. */
  public async list(
    options: CursorListOptions = {},
  ): Promise<ListCardsResponse> {
    return this.http.request<ListCardsResponse>({
      path: '/api/v1/cards/list',
      body: { limit: options.limit, cursor: options.cursor },
    });
  }

  /** Retrieves a single card via `POST /api/v1/cards/get`. */
  public async get(options: { cardId: string }): Promise<Card> {
    const response = await this.http.request<{ card: Card }>({
      path: '/api/v1/cards/get',
      body: { id: options.cardId },
    });
    return response.card;
  }
}
