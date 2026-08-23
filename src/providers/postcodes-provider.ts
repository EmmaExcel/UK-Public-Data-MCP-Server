import { AppError } from '../errors.js';
import { HttpClient } from '../clients/http-client.js';
import { normalizePostcode } from '../utils/normalize.js';

export interface PostcodeLookupResult {
  postcode: string;
  latitude: number;
  longitude: number;
  region?: string;
  country?: string;
  parliamentary_constituency?: string;
  local_authority?: string;
  admin_county?: string;
  codes?: Record<string, string>;
  source_url: string;
}

export interface NearbyPostcode {
  postcode: string;
  latitude: number;
  longitude: number;
  distance_m?: number;
  region?: string;
  country?: string;
  parliamentary_constituency?: string;
  local_authority?: string;
  admin_county?: string;
}

function toPostcodeSummary(item: Record<string, unknown>, fallbackPostcode: string): NearbyPostcode {
  return {
    postcode: typeof item.postcode === 'string' ? item.postcode : fallbackPostcode,
    latitude: Number(item.latitude ?? 0),
    longitude: Number(item.longitude ?? 0),
    distance_m: typeof item.distance === 'number' ? item.distance : undefined,
    region: typeof item.region === 'string' ? item.region : undefined,
    country: typeof item.country === 'string' ? item.country : undefined,
    parliamentary_constituency:
      typeof item.parliamentary_constituency === 'string' ? item.parliamentary_constituency : undefined,
    local_authority: typeof item.admin_district === 'string' ? item.admin_district : undefined,
    admin_county: typeof item.admin_county === 'string' ? item.admin_county : undefined,
  };
}

export class PostcodesProvider {
  private readonly baseUrl = 'https://api.postcodes.io';

  constructor(private readonly httpClient: HttpClient) {}

  async lookup(postcode: string): Promise<PostcodeLookupResult> {
    const normalized = normalizePostcode(postcode);
    const sourceUrl = `${this.baseUrl}/postcodes/${encodeURIComponent(normalized)}`;
    const response = await this.httpClient.request<{ result?: Record<string, unknown> }>({
      url: sourceUrl,
      source: 'postcodes.io',
      allowRetry: true,
    });

    if (!response.result) {
      throw new AppError('NOT_FOUND', `No postcode found for ${normalized}.`, {
        retryable: false,
        source: 'postcodes.io',
      });
    }

    const result = response.result;
    return {
      postcode: String(result.postcode ?? normalized),
      latitude: Number(result.latitude ?? 0),
      longitude: Number(result.longitude ?? 0),
      region: typeof result.region === 'string' ? result.region : undefined,
      country: typeof result.country === 'string' ? result.country : undefined,
      parliamentary_constituency:
        typeof result.parliamentary_constituency === 'string'
          ? result.parliamentary_constituency
          : undefined,
      local_authority: typeof result.admin_district === 'string' ? result.admin_district : undefined,
      admin_county: typeof result.admin_county === 'string' ? result.admin_county : undefined,
      codes: typeof result.codes === 'object' && result.codes ? (result.codes as Record<string, string>) : undefined,
      source_url: sourceUrl,
    };
  }

  async nearest(
    latitude: number,
    longitude: number,
    limit = 10,
    radiusM?: number,
  ): Promise<{ results: NearbyPostcode[]; source_url: string }> {
    const params = new URLSearchParams({
      lat: String(latitude),
      lon: String(longitude),
      limit: String(Math.min(Math.max(limit, 1), 100)),
    });
    if (radiusM !== undefined) {
      params.set('radius', String(radiusM));
    }
    const sourceUrl = `${this.baseUrl}/postcodes?${params.toString()}`;

    const response = await this.httpClient.request<{ result?: Array<Record<string, unknown>> }>({
      url: sourceUrl,
      source: 'postcodes.io',
      allowRetry: true,
    });

    return {
      results: (response.result ?? []).map((item) => toPostcodeSummary(item, '')),
      source_url: sourceUrl,
    };
  }

  async search(
    query: string,
    limit = 10,
  ): Promise<{ results: NearbyPostcode[]; source_url: string }> {
    const normalized = query.trim();
    const params = new URLSearchParams({
      q: normalized,
      limit: String(Math.min(Math.max(limit, 1), 100)),
    });
    const sourceUrl = `${this.baseUrl}/postcodes?${params.toString()}`;

    const response = await this.httpClient.request<{ result?: Array<Record<string, unknown>> }>({
      url: sourceUrl,
      source: 'postcodes.io',
      allowRetry: true,
    });

    return {
      results: (response.result ?? []).map((item) => toPostcodeSummary(item, '')),
      source_url: sourceUrl,
    };
  }
}
