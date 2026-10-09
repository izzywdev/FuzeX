// repositoryRef.ts — canonical repository keys shared by the importer and
// database-backed App adoption. FuzeX never fetches the URL; normalization
// merely lets legacy GitHub provenance match an explicit App connection.

export function canonicalRepositoryRef(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw)) return raw;
  const github = raw.match(/^(?:https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?(?:[?#].*)?$/i);
  return github ? `${github[1]}/${github[2]}` : raw;
}
