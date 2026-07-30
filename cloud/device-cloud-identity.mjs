import { createHmac } from 'node:crypto';

function normalizedSubject(value) {
  const subject = String(value || '');
  if (subject.length < 8 || subject.length > 200) throw new Error('invalid external subject');
  return subject;
}

function normalizedPepper(value) {
  const pepper = String(value || '');
  if (pepper.length < 32) throw new Error('subject pepper must contain at least 32 characters');
  return pepper;
}

function digest(label, subject, pepper) {
  return createHmac('sha256', normalizedPepper(pepper))
    .update(`${label}\0${normalizedSubject(subject)}`)
    .digest();
}

export function externalSubjectHash(subject, pepper) {
  return digest('nexora-external-subject-v1', subject, pepper);
}

export function ownerIdForExternalSubject(subject, pepper) {
  const bytes = digest('nexora-owner-id-v1', subject, pepper).subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
