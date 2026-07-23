/**
 * HOLON clinical-knowledge client, inlined into `@ontomorph/dtp-sdk`.
 *
 * A self-contained snapshot of `@holon/client` (plus the `HolonErrorCode` /
 * `HolonApiErrorResponse` subset of `@holon/types`), bundled here so the
 * published `@ontomorph/dtp-sdk` has zero external HOLON dependency and `dtp.holon`
 * resolves on a plain `npm install`. Kept as one dependency-free module; the
 * published `@holon/client` remains the standalone equivalent for direct use.
 */

// ── Error types (subset of @holon/types) ──────────────────────────────

/** Subset of HOLON error codes that the SDK surfaces to DTP callers. */
export enum HolonErrorCode {
  CONCEPT_NOT_FOUND = "CONCEPT_NOT_FOUND",
  NO_MAPPING_FOUND = "NO_MAPPING_FOUND",
  INTERACTION_CHECK_FAILED = "INTERACTION_CHECK_FAILED",
  PHENOTYPE_MATCH_FAILED = "PHENOTYPE_MATCH_FAILED",
  DB_ERROR = "DB_ERROR",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  LICENSE_REQUIRED = "LICENSE_REQUIRED",
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  NOT_IMPLEMENTED = "NOT_IMPLEMENTED",
}

/** Base error class thrown by the SDK on non-2xx responses. */
export class HolonApiErrorResponse extends Error {
  constructor(
    message: string,
    public readonly code: HolonErrorCode,
    public readonly details?: { status: number; body: unknown }
  ) {
    super(message);
    this.name = "HolonApiErrorResponse";
  }
}

// ── Wire types ────────────────────────────────────────────────────────

/** Configuration for the HOLON client. */
export interface HolonClientConfig {
  apiUrl: string;
  apiKey: string;
  timeout?: number;
}

/** Standard error body returned by the HOLON API. */
interface HolonApiErrorBody {
  error: string;
  code: string;
}

/** Concept envelope returned by the HOLON API. */
export interface ConceptResponse {
  concept: {
    conceptId: number;
    holonUri: string;
    vocabularyId: string;
    conceptCode: string;
    conceptName: string;
    domainId: string;
  };
  synonyms: string[];
}

/** Search result from the HOLON API. */
export interface SearchResponse {
  hits: Array<{
    conceptId: number;
    holonUri: string;
    conceptCode: string;
    conceptName: string;
    vocabularyId: string;
    domainId: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

/** Single ancestor row in an ancestry response. */
export interface AncestorEntry {
  ancestorConceptId: number;
  minLevels: number;
  maxLevels: number;
  conceptName: string;
  conceptCode: string;
}

/** Ancestry response from the HOLON API. */
export interface AncestryResponse {
  conceptId: number;
  ancestors: AncestorEntry[];
}

/** Single descendant row in a descendants response. */
export interface DescendantEntry {
  descendantConceptId: number;
  minLevels: number;
  maxLevels: number;
  conceptName: string;
  conceptCode: string;
}

/** Descendants response from the HOLON API. */
export interface DescendantsResponse {
  conceptId: number;
  descendants: DescendantEntry[];
}

/** Drug-drug interaction entry. */
export interface InteractionEntry {
  id: number;
  drugAConceptId: number;
  drugBConceptId: number;
  drugAName: string;
  drugBName: string;
  severity: string;
  mechanism: string | null;
  clinicalEffect: string;
  management: string;
  evidenceGrade: string;
  source: string;
}

/** Response from single-drug interaction lookup. */
export interface InteractionsResponse {
  conceptId: number;
  total: number;
  interactions: InteractionEntry[];
}

/** Response from pairwise interaction check. */
export interface InteractionCheckResponse {
  drugA: number;
  drugB: number;
  hasInteraction: boolean;
  interactions: InteractionEntry[];
}

/** Response from medication-list interaction check. */
export interface InteractionListResponse {
  totalDrugs: number;
  totalInteractions: number;
  pairs: Array<{ drugA: number; drugB: number; interactions: InteractionEntry[] }>;
}

/** One keyset-paginated page of the full interaction universe. */
export interface InteractionUniversePage {
  rows: InteractionEntry[];
  nextCursor: number | null;
}

/** Cross-vocabulary mapping entry. */
export interface MappingEntry {
  id: number;
  sourceConceptId: number;
  targetConceptId: number;
  relationshipType: string;
  equivalence: string;
  targetHolonUri: string;
  targetConceptCode: string;
  targetConceptName: string;
  targetVocabularyId: string;
}

/** Mapping lookup response. */
export interface MappingsResponse {
  conceptId: number;
  total: number;
  mappings: MappingEntry[];
}

/** One enriched mapping edge: both endpoints' code, name, and vocabulary. */
export interface MappingEdge {
  sourceCode: string;
  sourceName: string;
  sourceVocabulary: string;
  targetCode: string;
  targetName: string;
  targetVocabulary: string;
}

/** Response listing every mapping of a given relationship type. */
export interface MappingsByRelationshipResponse {
  relationshipType: string;
  edges: MappingEdge[];
}

/** Concept translation response. */
export interface TranslationResponse {
  source: { code: string; vocabulary: string };
  target: string;
  total: number;
  mappings: MappingEntry[];
}

/** Reference range entry. */
export interface ReferenceRangeEntry {
  id: number;
  conceptId: number;
  conceptCode: string;
  conceptName: string;
  ageMinYears: string | null;
  ageMaxYears: string | null;
  sex: string | null;
  lowValue: string | null;
  highValue: string | null;
  unit: string;
  interpretation: string | null;
  source: string;
}

/** Reference range lookup response. */
export interface ReferenceRangesResponse {
  total: number;
  ranges: ReferenceRangeEntry[];
}

/** Phenotype best-match entry. */
export interface PhenotypeMatch {
  termA: number;
  termB: number;
  mica: number;
  micaIc: number;
  micaName: string;
}

/** Phenotype similarity response. */
export interface PhenotypeMatchResponse {
  score: number;
  maxScore: number;
  normalizedScore: number;
  bestMatches: PhenotypeMatch[];
}

// ── HTTP helper ───────────────────────────────────────────────────────

class HolonHttpClient {
  constructor(private readonly config: HolonClientConfig) {}

  async get<T>(path: string, errorContext: string): Promise<T> {
    return this.request<T>(path, { method: "GET" }, errorContext);
  }

  async post<T>(path: string, body: unknown, errorContext: string): Promise<T> {
    return this.request<T>(
      path,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      errorContext
    );
  }

  async patch<T>(path: string, body: unknown, errorContext: string): Promise<T> {
    return this.request<T>(
      path,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      errorContext
    );
  }

  private async request<T>(path: string, init: RequestInit, errorContext: string): Promise<T> {
    const headers: Record<string, string> = {
      ...((init.headers as Record<string, string>) ?? {}),
      Authorization: `Bearer ${this.config.apiKey}`,
    };

    const opts: RequestInit = { ...init, headers };
    if (this.config.timeout !== undefined) {
      opts.signal = AbortSignal.timeout(this.config.timeout);
    }

    const res = await globalThis.fetch(`${this.config.apiUrl}${path}`, opts);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as HolonApiErrorBody | null;
      throw new HolonApiErrorResponse(
        `${errorContext}: ${body?.error ?? `HTTP ${res.status}`}`,
        (body?.code as HolonErrorCode) ?? HolonErrorCode.NOT_IMPLEMENTED,
        { status: res.status, body }
      );
    }
    return (await res.json()) as T;
  }
}

// ── Api classes ───────────────────────────────────────────────────────

/** Concept lookup and search operations. */
export class ConceptsApi {
  private readonly http: HolonHttpClient;

  constructor(config: HolonClientConfig) {
    this.http = new HolonHttpClient(config);
  }

  async getById(id: string): Promise<ConceptResponse> {
    return this.http.get(`/concepts/${encodeURIComponent(id)}`, "Concept lookup failed");
  }

  async getByCode(code: string, system: string): Promise<ConceptResponse> {
    const params = new URLSearchParams({ code, system });
    return this.http.get(`/concepts?${params}`, "Concept lookup failed");
  }

  async search(
    query: string,
    options?: { domain?: string; page?: number; pageSize?: number }
  ): Promise<SearchResponse> {
    const params = new URLSearchParams({ q: query });
    if (options?.domain) params.set("domain", options.domain);
    if (options?.page) params.set("page", String(options.page));
    if (options?.pageSize) params.set("pageSize", String(options.pageSize));
    return this.http.get(`/concepts?${params}`, "Concept search failed");
  }

  async getAncestors(conceptId: number): Promise<AncestryResponse> {
    return this.http.get(`/concepts/${conceptId}/ancestors`, "Ancestor lookup failed");
  }

  async getDescendants(conceptId: number): Promise<DescendantsResponse> {
    return this.http.get(`/concepts/${conceptId}/descendants`, "Descendant lookup failed");
  }
}

/** Drug interaction operations. */
export class InteractionsApi {
  private readonly http: HolonHttpClient;

  constructor(config: HolonClientConfig) {
    this.http = new HolonHttpClient(config);
  }

  async getByDrugId(conceptId: number): Promise<InteractionsResponse> {
    return this.http.get(`/interactions/drug/${conceptId}`, "Interaction lookup failed");
  }

  async check(drugA: number, drugB: number): Promise<InteractionCheckResponse> {
    const params = new URLSearchParams({ drugA: String(drugA), drugB: String(drugB) });
    return this.http.get(`/interactions/check?${params}`, "Interaction check failed");
  }

  async checkList(drugIds: number[]): Promise<InteractionListResponse> {
    return this.http.post(
      "/interactions/check-list",
      { drugIds: drugIds.map(String) },
      "Interaction list check failed"
    );
  }

  /**
   * Stream the full interaction universe by paging through HOLON's keyset-paginated
   * `/interactions/all` endpoint, invoking `onRow` for each interaction. Used to
   * build a boot-time index without ever materialising the whole universe in one
   * array: each bounded page is consumed then discarded, keeping peak memory low.
   */
  async streamAll(onRow: (row: InteractionEntry) => void): Promise<void> {
    let cursor = 0;
    for (;;) {
      const page = await this.http.get<InteractionUniversePage>(
        `/interactions/all?cursor=${cursor}&limit=50000`,
        "Interaction universe dump failed"
      );
      for (const row of page.rows) onRow(row);
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
  }
}

/** Cross-vocabulary mapping operations. */
export class MappingsApi {
  private readonly http: HolonHttpClient;

  constructor(config: HolonClientConfig) {
    this.http = new HolonHttpClient(config);
  }

  async getByConceptId(conceptId: number): Promise<MappingsResponse> {
    return this.http.get(`/mappings/${conceptId}`, "Mapping lookup failed");
  }

  async getByRelationship(relationshipType: string): Promise<MappingsByRelationshipResponse> {
    return this.http.get(
      `/mappings/by-relationship/${encodeURIComponent(relationshipType)}`,
      "Mappings by relationship lookup failed"
    );
  }

  async translate(code: string, source: string, target?: string): Promise<TranslationResponse> {
    const params = new URLSearchParams({ code, source });
    if (target) params.set("target", target);
    return this.http.get(`/mappings/translate?${params}`, "Translation failed");
  }
}

/** Lab reference range operations. */
export class ReferenceRangesApi {
  private readonly http: HolonHttpClient;

  constructor(config: HolonClientConfig) {
    this.http = new HolonHttpClient(config);
  }

  async getByConceptId(
    conceptId: number,
    age?: number,
    sex?: string
  ): Promise<ReferenceRangesResponse> {
    const params = new URLSearchParams();
    if (age !== undefined) params.set("age", String(age));
    if (sex) params.set("sex", sex);
    const qs = params.toString() ? `?${params}` : "";
    return this.http.get(`/reference-ranges/${conceptId}${qs}`, "Reference range lookup failed");
  }

  async getByLoincCode(
    loincCode: string,
    age?: number,
    sex?: string
  ): Promise<ReferenceRangesResponse> {
    const params = new URLSearchParams();
    if (age !== undefined) params.set("age", String(age));
    if (sex) params.set("sex", sex);
    const qs = params.toString() ? `?${params}` : "";
    return this.http.get(
      `/reference-ranges/loinc/${loincCode}${qs}`,
      "Reference range lookup failed"
    );
  }
}

/** HPO phenotype similarity operations. */
export class PhenotypeApi {
  private readonly http: HolonHttpClient;

  constructor(config: HolonClientConfig) {
    this.http = new HolonHttpClient(config);
  }

  async match(termsA: number[], termsB: number[]): Promise<PhenotypeMatchResponse> {
    return this.http.post(
      "/phenotype/match",
      { termsA: termsA.map(String), termsB: termsB.map(String) },
      "Phenotype match failed"
    );
  }
}

// ── Admin (consumer lifecycle) ────────────────────────────────────────

/** Public projection of a HOLON API consumer (key hash never included). */
export interface HolonConsumer {
  id: string;
  name: string;
  environment: string;
  role: string;
  licensedVocabularies: string[];
  rateLimitPerMinute: number | null;
  createdAt: string;
  active: boolean | null;
}

/** Response from consumer creation or key rotation, where `apiKey` is returned exactly once. */
export interface ConsumerKeyResponse {
  consumer: HolonConsumer;
  apiKey: string;
}

/**
 * Consumer lifecycle operations (admin-gated in HOLON, so the configured key must
 * belong to an admin consumer). Used by DTP to mint per-participant API keys.
 */
export class AdminApi {
  private readonly http: HolonHttpClient;

  constructor(config: HolonClientConfig) {
    this.http = new HolonHttpClient(config);
  }

  async createConsumer(input: {
    name: string;
    environment: string;
    rateLimitPerMinute?: number;
  }): Promise<ConsumerKeyResponse> {
    return this.http.post("/admin/consumers", input, "Consumer creation failed");
  }

  async regenerateKey(consumerId: string): Promise<ConsumerKeyResponse> {
    return this.http.post(
      `/admin/consumers/${encodeURIComponent(consumerId)}/regenerate`,
      {},
      "Consumer key rotation failed"
    );
  }

  async setActive(consumerId: string, active: boolean): Promise<{ consumer: HolonConsumer }> {
    return this.http.patch(
      `/admin/consumers/${encodeURIComponent(consumerId)}`,
      { active },
      "Consumer activation update failed"
    );
  }
}

// ── Client factory ────────────────────────────────────────────────────

/** Composite Holon API client. */
export interface HolonClient {
  concepts: ConceptsApi;
  interactions: InteractionsApi;
  mappings: MappingsApi;
  referenceRanges: ReferenceRangesApi;
  phenotype: PhenotypeApi;
  admin: AdminApi;
}

/** Create a Holon API client instance bound to the given configuration. */
export function createHolonClient(config: HolonClientConfig): HolonClient {
  return {
    concepts: new ConceptsApi(config),
    interactions: new InteractionsApi(config),
    mappings: new MappingsApi(config),
    referenceRanges: new ReferenceRangesApi(config),
    phenotype: new PhenotypeApi(config),
    admin: new AdminApi(config),
  };
}
