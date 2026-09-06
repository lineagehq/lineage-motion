import { canonicalJson } from '../../domain/src/index.ts';
import type { RequestAuth } from './index.ts';
import { parseProjectCatalog, parseShotAdmissionResponse, type ProjectCatalog, type ShotAdmissionCommand,
  type ShotAdmissionResponse } from './project.ts';
export class ProjectServiceClient {
  constructor(readonly baseUrl: string, private readonly auth: RequestAuth,
    private readonly request: typeof fetch = (...args) => fetch(...args)) {}
  private headers(secret?: string): Record<string, string> {
    const claimSecret = secret ?? this.auth.claimSecret;
    return { 'content-type': 'application/json', 'x-motion-actor': this.auth.actor,
      authorization: `Bearer ${this.auth.capability}`, ...(claimSecret ? { 'x-motion-claim-secret': claimSecret } : {}) };
  }
  async catalog(): Promise<ProjectCatalog> {
    const response = await this.request(`${this.baseUrl}/api/project/v1/catalog`, { headers: this.headers() });
    if (!response.ok) throw new Error('PROJECT_CATALOG_READ_FAILED');
    try { return parseProjectCatalog(await response.json()); } catch { throw new Error('PROJECT_CATALOG_RESPONSE_INVALID'); }
  }
  async admit(command: ShotAdmissionCommand, claimSecret?: string): Promise<ShotAdmissionResponse> {
    const response = await this.request(`${this.baseUrl}/api/project/v1/shots`, {
      method: 'POST', headers: this.headers(claimSecret), body: canonicalJson(command) });
    try { return parseShotAdmissionResponse(await response.json()); } catch { throw new Error('PROJECT_ADMISSION_RESPONSE_INVALID'); }
  }
}
