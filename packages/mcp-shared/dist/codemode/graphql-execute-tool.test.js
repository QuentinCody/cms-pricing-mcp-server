import { describe, it, expect, beforeAll } from "vitest";
import { createGraphqlExecuteTool, } from "./graphql-execute-tool";
const MOCK_INTROSPECTION = {
    queryType: { name: "Query" },
    types: [
        {
            name: "Query",
            kind: "OBJECT",
            fields: [
                {
                    name: "gene",
                    type: "Gene",
                    args: [{ name: "symbol", type: "String!" }],
                    description: "Look up a gene",
                },
            ],
        },
        {
            name: "Gene",
            kind: "OBJECT",
            fields: [
                { name: "id", type: "Int!" },
                { name: "name", type: "String" },
            ],
        },
    ],
};
const mockGqlFetch = async (query) => {
    if (query.includes("IntrospectionQuery")) {
        return { data: { __schema: MOCK_INTROSPECTION } };
    }
    return { data: { gene: { id: 1, name: "EGFR" } } };
};
/** Minimal stub for Worker Loader binding. */
const mockLoader = {
    get: () => ({
        getEntrypoint: () => ({
            evaluate: async () => ({
                result: { gene: { id: 1, name: "EGFR" } },
                logs: [],
            }),
        }),
    }),
};
function makeOptions(overrides) {
    return {
        prefix: "test",
        gqlFetch: mockGqlFetch,
        loader: mockLoader,
        introspection: MOCK_INTROSPECTION,
        ...overrides,
    };
}
describe("createGraphqlExecuteTool", () => {
    let tool;
    beforeAll(() => {
        tool = createGraphqlExecuteTool(makeOptions());
    });
    it("creates a tool with correct name", () => {
        expect(tool.name).toBe("test_execute");
    });
    it("has a code schema", () => {
        expect(tool.schema.code).toBeDefined();
    });
    it("includes gql.query in description", () => {
        expect(tool.description).toContain("gql.query");
    });
    it("includes schema helpers in description", () => {
        expect(tool.description).toContain("schema.types()");
        expect(tool.description).toContain("schema.queryRoot()");
    });
    it("includes staging documentation", () => {
        expect(tool.description).toContain("STAGING");
        expect(tool.description).toContain("auto-staged");
    });
    it("includes preamble notes in description when provided", () => {
        const withPreamble = createGraphqlExecuteTool(makeOptions({ preamble: "// Use entrezSymbol not symbol\n// Status is scalar" }));
        expect(withPreamble.description).toContain("Use entrezSymbol not symbol");
        expect(withPreamble.description).toContain("Status is scalar");
    });
    it("uses custom apiName in description", () => {
        const withName = createGraphqlExecuteTool(makeOptions({ apiName: "Pharos" }));
        expect(withName.description).toContain("Pharos GraphQL API");
    });
    it("has a register function", () => {
        expect(typeof tool.register).toBe("function");
    });
});
//# sourceMappingURL=graphql-execute-tool.test.js.map