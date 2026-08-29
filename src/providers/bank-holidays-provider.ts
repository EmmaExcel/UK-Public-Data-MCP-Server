import { HttpClient } from '../clients/http-client.js';

export type BankHolidayDivision = 'england-and-wales' | 'scotland' | 'northern-ireland';

export interface BankHolidayEvent {
  title?: string;
  date?: string;
  notes?: string;
  bunting?: boolean;
}

export interface BankHolidaysResult {
  division: BankHolidayDivision;
  events: Array<Record<string, unknown>>;
  source_url: string;
}

export class BankHolidaysProvider {
  private readonly baseUrl = 'https://www.gov.uk/bank-holidays.json';

  constructor(private readonly httpClient: HttpClient) {}

  async getAll(): Promise<Record<string, Record<string, unknown>>> {
    return this.httpClient.request<Record<string, Record<string, unknown>>>({
      url: this.baseUrl,
      source: 'govuk-bank-holidays',
      allowRetry: true,
    });
  }

  async getDivision(division: BankHolidayDivision, year?: number): Promise<BankHolidaysResult> {
    const all = await this.getAll();
    const payload = all[division] ?? { events: [] };
    const events = Array.isArray(payload.events) ? payload.events : [];
    const filtered =
      year === undefined
        ? events
        : events.filter((event) => {
            const eventDate =
              typeof event === 'object' && event && 'date' in event
                ? String((event as Record<string, unknown>).date)
                : '';
            return eventDate.startsWith(`${year}-`);
          });

    return {
      division,
      events: filtered,
      source_url: this.baseUrl,
    };
  }

  getBankHolidayEventFields(event: Record<string, unknown>): BankHolidayEvent {
    return {
      title: typeof event.title === 'string' ? event.title : undefined,
      date: typeof event.date === 'string' ? event.date : undefined,
      notes: typeof event.notes === 'string' ? event.notes : undefined,
      bunting: typeof event.bunting === 'boolean' ? event.bunting : undefined,
    };
  }
}
