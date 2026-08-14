import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { ActorKind, RequestAuth } from '../../motion-protocol/src/index.ts';

export type ServiceCapabilities = { human: string; agent: string };

const capabilityPattern = /^[A-Za-z0-9_-]{43,}$/;

export function validateServiceCapabilities(capabilities: ServiceCapabilities): ServiceCapabilities {
  if (!capabilityPattern.test(capabilities.human) || !capabilityPattern.test(capabilities.agent)
    || capabilities.human === capabilities.agent) throw new Error('SERVICE_CAPABILITIES_INVALID');
  return capabilities;
}

const equal = (left: string, right: string) => { const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b); };
export function authenticate(request: IncomingMessage, capabilities: ServiceCapabilities): RequestAuth | null {
  const actor = request.headers['x-motion-actor']; const authorization = request.headers.authorization;
  if ((actor !== 'human' && actor !== 'agent') || !authorization?.startsWith('Bearer ')) return null;
  const capability = authorization.slice(7); if (!equal(capability, capabilities[actor])) return null;
  const raw = request.headers['x-motion-claim-secret']; const claimSecret = Array.isArray(raw) ? undefined : raw;
  return { actor: actor as ActorKind, capability, ...(claimSecret ? { claimSecret } : {}) };
}
