import { HttpClient } from '../clients/http-client.js';
import { normalizePostcode } from '../utils/normalize.js';

export interface OdsOrganisation {
  ods_code?: string;
  organisation_name?: string;
  organisation_type?: string;
  status?: string;
  address?: string;
  postcode?: string;
  contact_details?: Record<string, unknown>;
  parent_organisation?: Record<string, unknown>;
  effective_dates?: Record<string, string>;
  source_url: string;
}

export interface OdsSearchResult {
  results: OdsOrganisation[];
  source_url: string;
}

/**
 * Adapter contract for NHS ODS data. The concrete provider targets the
 * directory.spineservices.nhs.uk ORD API by default, but the endpoint is
 * configurable via ODS_BASE_URL and an alternative adapter can be supplied
 * without changing tool registration.
 */
export interface OdsAdapter {
  lookup(odsCode: string): Promise<OdsOrganisation>;
  search(
    query: string,
    organisationType?: string,
    activeOnly?: boolean,
    limit?: number,
  ): Promise<OdsSearchResult>;
  byPostcode(postcode: string, activeOnly?: boolean): Promise<OdsSearchResult>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function toOrgId(orgId: unknown): string | undefined {
  if (typeof orgId === 'string') return orgId;
  const record = asRecord(orgId);
  if (!record) return undefined;
  return asString(record.extension) ?? asString(record.odsCode) ?? asString(record.OrgId);
}

function buildAddress(location: Record<string, unknown> | undefined): string | undefined {
  if (!location) return undefined;
  const parts = [
    asString(location.AddrLn1),
    asString(location.AddrLn2),
    asString(location.AddrLn3),
    asString(location.Town),
    asString(location.County),
    asString(location.Country),
    asString(location.PostCode),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function mapLookupOrganisation(organisation: Record<string, unknown>, sourceUrl: string): OdsOrganisation {
  const geoLoc = asRecord(organisation.GeoLoc);
  const location = asRecord(geoLoc?.Location);

  const roles = asRecord(organisation.Roles);
  const roleList = Array.isArray(roles?.Role) ? (roles?.Role as unknown[]) : [];
  const primaryRole = roleList
    .map(asRecord)
    .find((role) => role?.primaryRole === true) ?? roleList.map(asRecord)[0];
  const primaryRoleId = primaryRole ? asString(primaryRole.id) ?? asString(primaryRole.uniqueRoleId) : undefined;

  const dates = Array.isArray(organisation.Date) ? (organisation.Date as unknown[]) : [];
  const firstOperationalDate = dates
    .map(asRecord)
    .find((date) => date?.Type === 'Operational' || date?.Start);
  const effectiveDates: Record<string, string> | undefined =
    firstOperationalDate
      ? {
          type: asString(firstOperationalDate.Type) ?? 'Operational',
          start: asString(firstOperationalDate.Start) ?? '',
          end: asString(firstOperationalDate.End) ?? '',
        }
      : undefined;

  const contacts = asRecord(organisation.Contacts);
  const contactList = Array.isArray(contacts?.Contact) ? (contacts?.Contact as unknown[]) : [];
  const contactDetails: Record<string, unknown> | undefined =
    contactList.length > 0
      ? Object.fromEntries(
          contactList
            .map(asRecord)
            .filter((contact) => contact && typeof contact.type === 'string' && typeof contact.value === 'string')
            .map((contact) => [contact?.type as string, contact?.value as string]),
        )
      : undefined;

  const rels = asRecord(organisation.Rels);
  const relList = Array.isArray(rels?.Rel) ? (rels?.Rel as unknown[]) : [];
  const activeRel = relList
    .map(asRecord)
    .find((rel) => rel?.Status === 'Active') ?? relList.map(asRecord)[0];
  const parentOrganisation: Record<string, unknown> | undefined = activeRel
    ? (() => {
        const target = asRecord(activeRel.Target);
        const targetOrgId = toOrgId(target?.OrgId);
        const targetRole = asRecord(target?.PrimaryRoleId);
        return {
          ods_code: targetOrgId,
          relationship_id: asString(activeRel.id),
          relationship_type: asString(activeRel.Status) ?? 'Active',
          role_id: targetRole ? asString(targetRole.id) ?? asString(targetRole.uniqueRoleId) : undefined,
        };
      })()
    : undefined;

  return {
    ods_code: toOrgId(organisation.OrgId) ?? asString(organisation.odsCode),
    organisation_name: asString(organisation.Name) ?? asString(organisation.name),
    organisation_type: primaryRoleId,
    status: asString(organisation.Status) ?? asString(organisation.status),
    address: buildAddress(location),
    postcode: location ? normalizePostcode(asString(location.PostCode) ?? '') : undefined,
    contact_details: contactDetails,
    parent_organisation: parentOrganisation,
    effective_dates: effectiveDates,
    source_url: sourceUrl,
  };
}

function mapSearchOrganisation(item: Record<string, unknown>, sourceUrl: string): OdsOrganisation {
  const geoLoc = asRecord(item.GeoLoc);
  const location = asRecord(geoLoc?.Location);
  const postcode = asString(item.PostCode) ?? asString(location?.PostCode);
  return {
    ods_code: toOrgId(item.OrgId) ?? toOrgId(item.odsCode) ?? asString(item.odsCode),
    organisation_name: asString(item.Name) ?? asString(item.name),
    organisation_type:
      asString(item.PrimaryRoleDescription) ??
      asString(item.PrimaryRoleId) ??
      asString(item.organisationType),
    status: asString(item.Status) ?? asString(item.status),
    address: asString(item.Address) ?? buildAddress(location),
    postcode: postcode ? normalizePostcode(postcode) : undefined,
    contact_details: undefined,
    parent_organisation: undefined,
    effective_dates: undefined,
    source_url: sourceUrl,
  };
}

export class OdsProvider implements OdsAdapter {
  constructor(
    private readonly httpClient: HttpClient,
    private readonly baseUrl: string,
  ) {}

  async lookup(odsCode: string): Promise<OdsOrganisation> {
    const code = odsCode.trim();
    const sourceUrl = `${this.baseUrl}/${encodeURIComponent(code)}`;
    const response = await this.httpClient.request<Record<string, unknown>>({
      url: sourceUrl,
      source: 'nhs-ods',
      allowRetry: true,
    });

    const organisation = asRecord(response.Organisation) ?? asRecord(response.organisation) ?? response;
    return mapLookupOrganisation(organisation, sourceUrl);
  }

  async search(
    query: string,
    organisationType?: string,
    activeOnly = true,
    limit = 20,
  ): Promise<OdsSearchResult> {
    const params = new URLSearchParams({ name: query.trim() });
    if (activeOnly) {
      params.set('Status', 'Active');
    }
    const sourceUrl = `${this.baseUrl}?${params.toString()}`;

    const response = await this.httpClient.request<Record<string, unknown>>({
      url: sourceUrl,
      source: 'nhs-ods',
      allowRetry: true,
    });

    const rawItems = Array.isArray(response.Organisations) ? (response.Organisations as unknown[]) : [];
    const items = rawItems.map((item) => mapSearchOrganisation(asRecord(item) ?? {}, sourceUrl));

    const filtered = organisationType
      ? items.filter((item) => {
          const haystack = `${item.organisation_type ?? ''}`.toLowerCase();
          return haystack.includes(organisationType.toLowerCase());
        })
      : items;

    return {
      results: filtered.slice(0, Math.min(Math.max(limit, 1), 100)),
      source_url: sourceUrl,
    };
  }

  async byPostcode(postcode: string, activeOnly = true): Promise<OdsSearchResult> {
    const normalized = normalizePostcode(postcode);
    const params = new URLSearchParams({ PostCode: normalized });
    if (activeOnly) {
      params.set('Status', 'Active');
    }
    const sourceUrl = `${this.baseUrl}?${params.toString()}`;

    const response = await this.httpClient.request<Record<string, unknown>>({
      url: sourceUrl,
      source: 'nhs-ods',
      allowRetry: true,
    });

    const rawItems = Array.isArray(response.Organisations) ? (response.Organisations as unknown[]) : [];
    return {
      results: rawItems.map((item) => mapSearchOrganisation(asRecord(item) ?? {}, sourceUrl)),
      source_url: sourceUrl,
    };
  }
}
