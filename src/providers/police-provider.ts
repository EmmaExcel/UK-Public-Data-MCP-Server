import { HttpClient } from '../clients/http-client.js';
import { AppError } from '../errors.js';
import type { PostcodesProvider } from './postcodes-provider.js';

export interface PoliceForce {
  force_id: string;
  name: string;
}

export interface Neighbourhood {
  id: string;
  name: string;
  description?: string;
  links?: Record<string, string>;
}

export interface CrimeLocation {
  latitude?: string;
  longitude?: string;
  street?: { id?: number; name?: string };
}

export interface CrimeItem {
  category?: string;
  location_type?: string;
  month?: string;
  outcome_status?: string | null;
  location?: CrimeLocation;
  persistent_id?: string;
  context?: string;
}

export interface CrimeResult {
  crimes: CrimeItem[];
  source_url: string;
}

export interface PoliceForcesResult {
  forces: PoliceForce[];
  source_url: string;
}

export interface NeighbourhoodsResult {
  neighbourhoods: Neighbourhood[];
  source_url: string;
}

export interface CrimesByPostcodeResult {
  partial: boolean;
  resolved_postcode?: string;
  latitude?: number;
  longitude?: number;
  crimes?: CrimeItem[];
  error?: string;
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

function toCrime(item: Record<string, unknown>): CrimeItem {
  const location = asRecord(item.location);
  const street = asRecord(location?.street);
  const outcomeRecord = asRecord(item.outcome_status);
  return {
    category: typeof item.category === 'string' ? item.category : undefined,
    location_type: typeof item.location_type === 'string' ? item.location_type : undefined,
    month: typeof item.month === 'string' ? item.month : undefined,
    outcome_status: item.outcome_status === null ? null
      : typeof outcomeRecord?.category === 'string' ? outcomeRecord.category : undefined,
    location: location
      ? {
          latitude: typeof location.latitude === 'string' ? location.latitude : undefined,
          longitude: typeof location.longitude === 'string' ? location.longitude : undefined,
          street: street
            ? {
                id: typeof street.id === 'number' ? street.id : undefined,
                name: typeof street.name === 'string' ? street.name : undefined,
              }
            : undefined,
        }
      : undefined,
    persistent_id: typeof item.persistent_id === 'string' ? item.persistent_id : undefined,
    context: typeof item.context === 'string' ? item.context : undefined,
  };
}

export class PoliceProvider {
  private readonly baseUrl = 'https://data.police.uk/api';

  constructor(
    private readonly httpClient: HttpClient,
    private readonly postcodesProvider: PostcodesProvider,
  ) {}

  async getForces(): Promise<PoliceForcesResult> {
    const sourceUrl = `${this.baseUrl}/forces`;
    const response = await this.httpClient.request<Array<Record<string, unknown>>>({
      url: sourceUrl,
      source: 'police.uk',
      allowRetry: true,
    });

    return {
      forces: response.map((item) => ({
        force_id: typeof item.id === 'string' ? item.id : '',
        name: typeof item.name === 'string' ? item.name : '',
      })),
      source_url: sourceUrl,
    };
  }

  async getNeighbourhoods(forceId: string): Promise<NeighbourhoodsResult> {
    const sourceUrl = `${this.baseUrl}/${encodeURIComponent(forceId)}/neighbourhoods`;
    const response = await this.httpClient.request<Array<Record<string, unknown>>>({
      url: sourceUrl,
      source: 'police.uk',
      allowRetry: true,
    });

    return {
      neighbourhoods: response.map((item) => ({
        id: typeof item.id === 'string' ? item.id : '',
        name: typeof item.name === 'string' ? item.name : '',
        description: typeof item.description === 'string' ? item.description : undefined,
        links: asStringRecord(item.links),
      })),
      source_url: sourceUrl,
    };
  }

  async getCrimesAtLocation(latitude: number, longitude: number, date?: string): Promise<CrimeResult> {
    const params = new URLSearchParams({
      lat: String(latitude),
      lng: String(longitude),
    });
    if (date) params.set('date', date);
    const sourceUrl = `${this.baseUrl}/crimes-at-location?${params.toString()}`;

    const response = await this.httpClient.request<Array<Record<string, unknown>>>({
      url: sourceUrl,
      source: 'police.uk',
      allowRetry: true,
    });

    return {
      crimes: response.map(toCrime),
      source_url: sourceUrl,
    };
  }

  async getCrimesByPostcode(postcode: string, date?: string): Promise<CrimesByPostcodeResult> {
    const resolved = await this.postcodesProvider.lookup(postcode);
    const crimeResult = await this.getCrimesAtLocation(resolved.latitude, resolved.longitude, date);
    return {
      partial: false,
      resolved_postcode: resolved.postcode,
      latitude: resolved.latitude,
      longitude: resolved.longitude,
      crimes: crimeResult.crimes,
      source_url: crimeResult.source_url,
    };
  }

  async getCrimesByPostcodeWithPartial(postcode: string, date?: string): Promise<CrimesByPostcodeResult> {
    let resolved;
    try {
      resolved = await this.postcodesProvider.lookup(postcode);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not resolve postcode.';
      throw new AppError('NOT_FOUND', message, { retryable: false, source: 'police.uk' });
    }

    try {
      const crimeResult = await this.getCrimesAtLocation(resolved.latitude, resolved.longitude, date);
      return {
        partial: false,
        resolved_postcode: resolved.postcode,
        latitude: resolved.latitude,
        longitude: resolved.longitude,
        crimes: crimeResult.crimes,
        source_url: crimeResult.source_url,
      };
    } catch (error) {
      return {
        partial: true,
        resolved_postcode: resolved.postcode,
        latitude: resolved.latitude,
        longitude: resolved.longitude,
        error: error instanceof Error ? error.message : 'Police data could not be loaded.',
        source_url: `${this.baseUrl}/crimes-at-location?lat=${resolved.latitude}&lng=${resolved.longitude}${date ? `&date=${date}` : ''}`,
      };
    }
  }
}
