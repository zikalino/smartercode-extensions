export interface ResourceRecord {
  [key: string]: unknown;
}

export function getLabelFromRecord(record: ResourceRecord): string {
  const candidates = ['name', 'title', 'hostname', 'uuid', 'id'];
  for (const field of candidates) {
    const value = record[field];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  return 'Unnamed resource';
}

export function getDescriptionFromRecord(record: ResourceRecord): string {
  const candidates = ['uuid', 'id', 'zone', 'state', 'status'];
  const parts: string[] = [];

  for (const field of candidates) {
    const value = record[field];
    if (typeof value === 'string' && value.trim().length > 0) {
      parts.push(`${field}: ${value}`);
    }
  }

  return parts.join(' • ');
}

export function toPrettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function buildExtensionGreeting(name: string): string {
  return `Hello from ${name}. Shared code is working.`;
}
