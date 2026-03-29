/**
 * GraphQL introspection — fetch, trim, and cache introspection results
 * for injection into V8 isolates.
 *
 * The trimmed representation strips internal types, deprecated fields,
 * and flattens nested ofType chains to keep the payload under ~50KB.
 */
/** Function signature for executing a GraphQL query against a server. */
export type GraphqlFetchFn = (query: string, variables?: Record<string, unknown>) => Promise<{
    data?: Record<string, unknown>;
    errors?: Array<{
        message: string;
        [key: string]: unknown;
    }>;
}>;
export interface TrimmedArg {
    name: string;
    type: string;
    defaultValue?: string;
    description?: string;
}
export interface TrimmedField {
    name: string;
    type: string;
    args?: TrimmedArg[];
    description?: string;
}
export interface TrimmedInputField {
    name: string;
    type: string;
    defaultValue?: string;
    description?: string;
}
export interface TrimmedType {
    name: string;
    kind: string;
    description?: string;
    fields?: TrimmedField[];
    inputFields?: TrimmedInputField[];
    enumValues?: Array<{
        name: string;
        description?: string;
    }>;
    possibleTypes?: Array<{
        name: string;
    }>;
}
export interface TrimmedIntrospection {
    queryType: {
        name: string;
    };
    mutationType?: {
        name: string;
    };
    types: TrimmedType[];
}
export declare const INTROSPECTION_QUERY = "\nquery IntrospectionQuery {\n  __schema {\n    queryType { name }\n    mutationType { name }\n    types {\n      name\n      kind\n      description\n      fields(includeDeprecated: false) {\n        name\n        description\n        type { ...TypeRef }\n        args {\n          name\n          description\n          type { ...TypeRef }\n          defaultValue\n        }\n      }\n      inputFields {\n        name\n        description\n        type { ...TypeRef }\n        defaultValue\n      }\n      enumValues(includeDeprecated: false) {\n        name\n        description\n      }\n      possibleTypes { name }\n    }\n  }\n}\n\nfragment TypeRef on __Type {\n  kind\n  name\n  ofType {\n    kind\n    name\n    ofType {\n      kind\n      name\n      ofType {\n        kind\n        name\n        ofType {\n          kind\n          name\n          ofType {\n            kind\n            name\n            ofType {\n              kind\n              name\n            }\n          }\n        }\n      }\n    }\n  }\n}\n";
interface RawTypeRef {
    kind: string;
    name?: string | null;
    ofType?: RawTypeRef | null;
}
/**
 * Flatten a nested GraphQL type reference into a compact string.
 *   NON_NULL(LIST(NON_NULL(OBJECT "Gene")))  →  "[Gene!]!"
 */
export declare function flattenTypeRef(ref: RawTypeRef | null | undefined): string;
/**
 * Trim a raw introspection result into a compact representation
 * suitable for injection into V8 isolates.
 */
export declare function trimIntrospectionResult(raw: Record<string, unknown>): TrimmedIntrospection;
/**
 * Fetch introspection from a GraphQL endpoint and return a trimmed result.
 */
export declare function fetchIntrospection(gqlFetch: GraphqlFetchFn): Promise<TrimmedIntrospection>;
export {};
//# sourceMappingURL=graphql-introspection.d.ts.map