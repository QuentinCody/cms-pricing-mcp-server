/**
 * GraphQL introspection — fetch, trim, and cache introspection results
 * for injection into V8 isolates.
 *
 * The trimmed representation strips internal types, deprecated fields,
 * and flattens nested ofType chains to keep the payload under ~50KB.
 */
// ---------------------------------------------------------------------------
// Introspection query
// ---------------------------------------------------------------------------
export const INTROSPECTION_QUERY = `
query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    types {
      name
      kind
      description
      fields(includeDeprecated: false) {
        name
        description
        type { ...TypeRef }
        args {
          name
          description
          type { ...TypeRef }
          defaultValue
        }
      }
      inputFields {
        name
        description
        type { ...TypeRef }
        defaultValue
      }
      enumValues(includeDeprecated: false) {
        name
        description
      }
      possibleTypes { name }
    }
  }
}

fragment TypeRef on __Type {
  kind
  name
  ofType {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
            }
          }
        }
      }
    }
  }
}
`;
/**
 * Flatten a nested GraphQL type reference into a compact string.
 *   NON_NULL(LIST(NON_NULL(OBJECT "Gene")))  →  "[Gene!]!"
 */
export function flattenTypeRef(ref) {
    if (!ref)
        return "Unknown";
    if (ref.kind === "NON_NULL") {
        const inner = flattenTypeRef(ref.ofType);
        return `${inner}!`;
    }
    if (ref.kind === "LIST") {
        const inner = flattenTypeRef(ref.ofType);
        return `[${inner}]`;
    }
    return ref.name ?? ref.kind ?? "Unknown";
}
// ---------------------------------------------------------------------------
// Trimming
// ---------------------------------------------------------------------------
const MAX_DESCRIPTION_LENGTH = 100;
const INTERNAL_TYPE_PREFIX = "__";
function truncate(s, max) {
    if (!s)
        return undefined;
    if (s.length <= max)
        return s;
    return `${s.slice(0, max - 3)}...`;
}
function trimArg(raw) {
    return {
        name: String(raw.name || ""),
        type: flattenTypeRef(raw.type),
        ...(raw.defaultValue != null ? { defaultValue: String(raw.defaultValue) } : {}),
        ...(raw.description ? { description: truncate(String(raw.description), MAX_DESCRIPTION_LENGTH) } : {}),
    };
}
function trimField(raw) {
    const args = Array.isArray(raw.args) && raw.args.length > 0
        ? raw.args.map((a) => trimArg(a))
        : undefined;
    return {
        name: String(raw.name || ""),
        type: flattenTypeRef(raw.type),
        ...(args ? { args } : {}),
        ...(raw.description ? { description: truncate(String(raw.description), MAX_DESCRIPTION_LENGTH) } : {}),
    };
}
function trimInputField(raw) {
    return {
        name: String(raw.name || ""),
        type: flattenTypeRef(raw.type),
        ...(raw.defaultValue != null ? { defaultValue: String(raw.defaultValue) } : {}),
        ...(raw.description ? { description: truncate(String(raw.description), MAX_DESCRIPTION_LENGTH) } : {}),
    };
}
function trimType(raw) {
    const name = String(raw.name || "");
    // Skip internal/introspection types
    if (name.startsWith(INTERNAL_TYPE_PREFIX))
        return null;
    // Skip built-in scalar types
    const builtinScalars = new Set(["String", "Int", "Float", "Boolean", "ID"]);
    if (raw.kind === "SCALAR" && builtinScalars.has(name))
        return null;
    const result = {
        name,
        kind: String(raw.kind || "OBJECT"),
    };
    const desc = truncate(raw.description, MAX_DESCRIPTION_LENGTH);
    if (desc)
        result.description = desc;
    if (Array.isArray(raw.fields) && raw.fields.length > 0) {
        result.fields = raw.fields.map((f) => trimField(f));
    }
    if (Array.isArray(raw.inputFields) && raw.inputFields.length > 0) {
        result.inputFields = raw.inputFields.map((f) => trimInputField(f));
    }
    if (Array.isArray(raw.enumValues) && raw.enumValues.length > 0) {
        result.enumValues = raw.enumValues.map((e) => ({
            name: String(e.name || ""),
            ...(e.description ? { description: truncate(String(e.description), MAX_DESCRIPTION_LENGTH) } : {}),
        }));
    }
    if (Array.isArray(raw.possibleTypes) && raw.possibleTypes.length > 0) {
        result.possibleTypes = raw.possibleTypes.map((t) => ({
            name: String(t.name || ""),
        }));
    }
    return result;
}
/**
 * Trim a raw introspection result into a compact representation
 * suitable for injection into V8 isolates.
 */
export function trimIntrospectionResult(raw) {
    const schema = raw.__schema
        ?? raw;
    const queryType = schema.queryType;
    const mutationType = schema.mutationType;
    const rawTypes = Array.isArray(schema.types) ? schema.types : [];
    const types = [];
    for (const rawType of rawTypes) {
        const trimmed = trimType(rawType);
        if (trimmed)
            types.push(trimmed);
    }
    return {
        queryType: queryType || { name: "Query" },
        ...(mutationType ? { mutationType } : {}),
        types,
    };
}
// ---------------------------------------------------------------------------
// Fetch + trim
// ---------------------------------------------------------------------------
/**
 * Fetch introspection from a GraphQL endpoint and return a trimmed result.
 */
export async function fetchIntrospection(gqlFetch) {
    const response = await gqlFetch(INTROSPECTION_QUERY);
    if (response.errors && !response.data) {
        const msg = response.errors.map((e) => e.message).join("; ");
        throw new Error(`Introspection query failed: ${msg}`);
    }
    if (!response.data?.__schema) {
        throw new Error("Introspection response missing __schema field");
    }
    return trimIntrospectionResult(response.data);
}
//# sourceMappingURL=graphql-introspection.js.map