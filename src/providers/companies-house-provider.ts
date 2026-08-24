import { configurationError } from '../errors.js';
import { HttpClient } from '../clients/http-client.js';
import type { UpstreamConfig } from '../types.js';

export interface CompanySearchItem {
  company_number: string;
  title: string;
  company_status?: string;
  company_type?: string;
  date_of_creation?: string;
  registered_office_address?: Record<string, unknown>;
  links?: Record<string, string>;
}

export interface CompanySearchResult {
  items: CompanySearchItem[];
  total_results: number;
  items_per_page: number;
  start_index: number;
  source_url: string;
}

export interface CompanyProfile {
  company_name?: string;
  company_number: string;
  company_status?: string;
  type?: string;
  date_of_creation?: string;
  registered_office_address?: Record<string, unknown>;
  sic_codes?: string[];
  accounts?: Record<string, unknown>;
  confirmation_statement?: Record<string, unknown>;
  jurisdiction?: string;
  has_been_liquidated?: boolean;
  date_of_cessation?: string;
  links?: Record<string, string>;
  source_url: string;
}

export interface OfficerItem {
  name?: string;
  role?: string;
  appointed_on?: string;
  resigned_on?: string;
  nationality?: string;
  occupation?: string;
  country_of_residence?: string;
  links?: Record<string, string>;
}

export interface OfficerResult {
  items: OfficerItem[];
  items_per_page: number;
  start_index: number;
  total_results?: number;
  source_url: string;
}

export interface FilingHistoryItem {
  filing_date?: string;
  category?: string;
  description?: string;
  transaction_id?: string;
  links?: Record<string, string>;
}

export interface FilingHistoryResult {
  items: FilingHistoryItem[];
  items_per_page: number;
  start_index: number;
  total_results?: number;
  source_url: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

export class CompaniesHouseProvider {
  private readonly baseUrl: string;

  constructor(
    private readonly httpClient: HttpClient,
    private readonly config: UpstreamConfig,
  ) {
    this.baseUrl = config.companiesHouseBaseUrl;
  }

  private getApiKey(): string {
    const apiKey = this.config.companiesHouseApiKey;
    if (!apiKey || !apiKey.trim()) {
      throw configurationError('COMPANIES_HOUSE_API_KEY is required to use Companies House tools.');
    }
    return apiKey;
  }

  private getAuthHeader(): Record<string, string> {
    const key = this.getApiKey();
    return {
      Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
      Accept: 'application/json',
    };
  }

  async search(query: string, itemsPerPage = 20, startIndex = 0): Promise<CompanySearchResult> {
    const params = new URLSearchParams({
      q: query,
      items_per_page: String(Math.min(Math.max(itemsPerPage, 1), 100)),
      start_index: String(Math.max(startIndex, 0)),
    });
    const sourceUrl = `${this.baseUrl}/search/companies?${params.toString()}`;

    const response = await this.httpClient.request<{
      items?: Array<Record<string, unknown>>;
      total_results?: number;
    }>({
      url: sourceUrl,
      method: 'GET',
      headers: this.getAuthHeader(),
      source: 'companies-house',
      allowRetry: true,
    });

    return {
      items: (response.items ?? []).map((item) => ({
        company_number: typeof item.company_number === 'string' ? item.company_number : '',
        title: typeof item.title === 'string' ? item.title : '',
        company_status: typeof item.company_status === 'string' ? item.company_status : undefined,
        company_type: typeof item.company_type === 'string' ? item.company_type : undefined,
        date_of_creation: typeof item.date_of_creation === 'string' ? item.date_of_creation : undefined,
        registered_office_address: asRecord(item.registered_office_address),
        links: asStringRecord(item.links),
      })),
      total_results: response.total_results ?? 0,
      items_per_page: itemsPerPage,
      start_index: startIndex,
      source_url: sourceUrl,
    };
  }

  async getProfile(companyNumber: string): Promise<CompanyProfile> {
    const sourceUrl = `${this.baseUrl}/company/${encodeURIComponent(companyNumber)}`;
    const response = await this.httpClient.request<Record<string, unknown>>({
      url: sourceUrl,
      method: 'GET',
      headers: this.getAuthHeader(),
      source: 'companies-house',
      allowRetry: true,
    });

    return {
      company_name: typeof response.company_name === 'string' ? response.company_name : undefined,
      company_number: typeof response.company_number === 'string' ? response.company_number : companyNumber,
      company_status: typeof response.company_status === 'string' ? response.company_status : undefined,
      type: typeof response.type === 'string' ? response.type : undefined,
      date_of_creation: typeof response.date_of_creation === 'string' ? response.date_of_creation : undefined,
      registered_office_address: asRecord(response.registered_office_address),
      sic_codes: Array.isArray(response.sic_codes)
        ? response.sic_codes.filter((code): code is string => typeof code === 'string')
        : undefined,
      accounts: asRecord(response.accounts),
      confirmation_statement: asRecord(response.confirmation_statement),
      jurisdiction: typeof response.jurisdiction === 'string' ? response.jurisdiction : undefined,
      has_been_liquidated:
        typeof response.has_been_liquidated === 'boolean' ? response.has_been_liquidated : undefined,
      date_of_cessation:
        typeof response.date_of_cessation === 'string' ? response.date_of_cessation : undefined,
      links: asStringRecord(response.links),
      source_url: sourceUrl,
    };
  }

  async getOfficers(companyNumber: string, itemsPerPage = 20, startIndex = 0): Promise<OfficerResult> {
    const params = new URLSearchParams({
      items_per_page: String(Math.min(Math.max(itemsPerPage, 1), 100)),
      start_index: String(Math.max(startIndex, 0)),
    });
    const sourceUrl = `${this.baseUrl}/company/${encodeURIComponent(companyNumber)}/officers?${params.toString()}`;

    const response = await this.httpClient.request<Record<string, unknown>>({
      url: sourceUrl,
      method: 'GET',
      headers: this.getAuthHeader(),
      source: 'companies-house',
      allowRetry: true,
    });

    const items = Array.isArray(response.items) ? response.items : [];
    return {
      items: items.map((raw) => {
        const item = asRecord(raw) ?? {};
        return {
          name: typeof item.name === 'string' ? item.name : undefined,
          role: typeof item.officer_role === 'string' ? item.officer_role : undefined,
          appointed_on: typeof item.appointed_on === 'string' ? item.appointed_on : undefined,
          resigned_on: typeof item.resigned_on === 'string' ? item.resigned_on : undefined,
          nationality: typeof item.nationality === 'string' ? item.nationality : undefined,
          occupation: typeof item.occupation === 'string' ? item.occupation : undefined,
          country_of_residence:
            typeof item.country_of_residence === 'string' ? item.country_of_residence : undefined,
          links: asStringRecord(item.links),
        };
      }),
      items_per_page: itemsPerPage,
      start_index: startIndex,
      total_results: typeof response.total_results === 'number' ? response.total_results : undefined,
      source_url: sourceUrl,
    };
  }

  async getFilingHistory(
    companyNumber: string,
    itemsPerPage = 20,
    startIndex = 0,
  ): Promise<FilingHistoryResult> {
    const params = new URLSearchParams({
      items_per_page: String(Math.min(Math.max(itemsPerPage, 1), 100)),
      start_index: String(Math.max(startIndex, 0)),
    });
    const sourceUrl = `${this.baseUrl}/company/${encodeURIComponent(companyNumber)}/filing-history?${params.toString()}`;

    const response = await this.httpClient.request<Record<string, unknown>>({
      url: sourceUrl,
      method: 'GET',
      headers: this.getAuthHeader(),
      source: 'companies-house',
      allowRetry: true,
    });

    const items = Array.isArray(response.items) ? response.items : [];
    return {
      items: items.map((raw) => {
        const item = asRecord(raw) ?? {};
        return {
          filing_date: typeof item.date === 'string' ? item.date : undefined,
          category: typeof item.category === 'string' ? item.category : undefined,
          description: typeof item.description === 'string' ? item.description : undefined,
          transaction_id: typeof item.transaction_id === 'string' ? item.transaction_id : undefined,
          links: asStringRecord(item.links),
        };
      }),
      items_per_page: itemsPerPage,
      start_index: startIndex,
      total_results: typeof response.total_results === 'number' ? response.total_results : undefined,
      source_url: sourceUrl,
    };
  }
}
