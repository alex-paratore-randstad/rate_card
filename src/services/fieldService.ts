import { FieldDefinition } from '../types/rateCard';

const COLLECTION_FIELDS = 'field_definitions';
const COLLECTIONS_BASE = '/domo/datastores/v1/collections';
const LOCAL_STORAGE_KEY = 'randstad_field_definitions';

/** Fields pre-seeded on first load — covers the known rate card columns */
export const DEFAULT_FIELD_DEFINITIONS: FieldDefinition[] = [
  { key: 'site',                      label: 'Site',                                 fieldType: 'text'   },
  { key: 'country',                   label: 'Country',                              fieldType: 'text'   },
  { key: 'state',                     label: 'State',                                fieldType: 'text'   },
  { key: 'mra_min_bill_rate',         label: 'MRA Min Suggested Bill Rate',          fieldType: 'number' },
  { key: 'mra_max_bill_rate',         label: 'MRA Max Suggested Bill Rate',          fieldType: 'number' },
  { key: 'mra_location_min',          label: 'MRA Suggested BR Location Based Min',  fieldType: 'number' },
  { key: 'mra_location_max',          label: 'MRA Suggested BR Location Based Max',  fieldType: 'number' },
  { key: 'avg_template_bill_rate',    label: 'Avg Template Bill Rate',               fieldType: 'number' },
  { key: 'variance',                  label: 'Variance',                             fieldType: 'number' },
];

function isDomoEnvironment(): boolean {
  return typeof window !== 'undefined' && !!window.domo && typeof window.domo.get === 'function';
}

function unwrapDocuments<T>(docs: any[]): T[] {
  if (!Array.isArray(docs)) return [];
  return docs.map((doc) => (doc.content !== undefined ? doc.content : doc)) as T[];
}

/** Load all field definitions. Returns defaults if collection is empty. */
export const fetchFieldDefinitions = async (): Promise<FieldDefinition[]> => {
  if (isDomoEnvironment()) {
    try {
      const docs = await window.domo.get(`${COLLECTIONS_BASE}/${COLLECTION_FIELDS}/documents/`);
      const fields = unwrapDocuments<FieldDefinition>(docs);
      if (fields.length > 0) return fields;
    } catch (err) {
      console.warn('[fieldService] Domo fetch failed, using local fallback:', err);
    }
  }

  const localData = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (localData) {
    try {
      const parsed = JSON.parse(localData) as FieldDefinition[];
      if (parsed.length > 0) return parsed;
    } catch {
      // ignore
    }
  }

  // First run — seed defaults
  await saveAllFieldDefinitions(DEFAULT_FIELD_DEFINITIONS);
  return DEFAULT_FIELD_DEFINITIONS;
};

/** Persist the entire field list (used for initial seed). */
const saveAllFieldDefinitions = async (fields: FieldDefinition[]): Promise<void> => {
  if (isDomoEnvironment()) {
    try {
      await Promise.all(
        fields.map((f) =>
          window.domo.post(`${COLLECTIONS_BASE}/${COLLECTION_FIELDS}/documents/`, f)
        )
      );
      return;
    } catch (err) {
      console.warn('[fieldService] Domo save failed, using local fallback:', err);
    }
  }
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(fields));
};

/** Add a single new field definition and persist it. */
export const addFieldDefinition = async (
  field: FieldDefinition,
  currentFields: FieldDefinition[]
): Promise<FieldDefinition[]> => {
  // Prevent duplicate keys
  if (currentFields.some((f) => f.key === field.key)) return currentFields;

  const updated = [...currentFields, field];

  if (isDomoEnvironment()) {
    try {
      await window.domo.post(`${COLLECTIONS_BASE}/${COLLECTION_FIELDS}/documents/`, field);
      return updated;
    } catch (err) {
      console.warn('[fieldService] Domo add failed, using local fallback:', err);
    }
  }

  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
  return updated;
};

/** Remove a field definition by key and persist the updated list. */
export const removeFieldDefinition = async (
  key: string,
  currentFields: FieldDefinition[]
): Promise<FieldDefinition[]> => {
  const updated = currentFields.filter((f) => f.key !== key);

  // For simplicity in both Domo and local fallback, overwrite the full list
  if (isDomoEnvironment()) {
    try {
      // Domo Collections doesn't support bulk delete easily; overwrite via local for now
      // and reseed on next load if needed
    } catch (err) {
      console.warn('[fieldService] Domo remove failed:', err);
    }
  }

  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updated));
  return updated;
};

/** Generate a safe key from a human label ("MRA Min Rate" → "mra_min_rate") */
export const labelToKey = (label: string): string =>
  label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
