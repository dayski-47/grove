import { describe, it, expect } from "vitest";
import { parseMarkdown } from "./shared";

describe("parseMarkdown — code blocks", () => {
    it("renders a fenced block with no language tag as a pre>code pair", () => {
        const nodes = parseMarkdown("```\nconst x = 1;\n```", "alice");
        expect(nodes).toHaveLength(1);
        const pre = nodes[0] as any;
        expect(pre.type).toBe("pre");
        expect(pre.props.className).toBe("dw-code-block");
    });

    it("captures the code content verbatim, without recursively parsing markdown inside it", () => {
        const nodes = parseMarkdown("```\n**not bold** inside code\n```", "alice");
        const pre = nodes[0] as any;
        const codeEl = pre.props.children[1];
        expect(codeEl.type).toBe("code");
        expect(codeEl.props.children).toBe("**not bold** inside code");
    });

    it("shows the language tag as a label when present", () => {
        const nodes = parseMarkdown("```rust\nfn main() {}\n```", "alice");
        const pre = nodes[0] as any;
        const langEl = pre.props.children[0];
        expect(langEl.type).toBe("span");
        expect(langEl.props.className).toBe("dw-code-block-lang");
        expect(langEl.props.children).toBe("rust");
    });

    it("omits the language label entirely when no language tag is given", () => {
        const nodes = parseMarkdown("```\nplain\n```", "alice");
        const pre = nodes[0] as any;
        expect(pre.props.children[0]).toBeFalsy();
    });

    it("still parses formatting outside the fence, on both sides", () => {
        const nodes = parseMarkdown("before ```\ncode\n``` **after**", "alice");
        expect(nodes[0]).toBe("before ");
        const pre = nodes[1] as any;
        expect(pre.type).toBe("pre");
        expect(nodes[2]).toBe(" ");
        const bold = nodes[3] as any;
        expect(bold.type).toBe("strong");
        expect(bold.props.children).toBe("after");
    });

    it("does not treat an unterminated triple-backtick as a code block", () => {
        const nodes = parseMarkdown("``` unterminated", "alice");
        expect(nodes).toEqual(["``` unterminated"]);
    });

    it("handles two separate fences in one message as two separate blocks", () => {
        const nodes = parseMarkdown("```\na\n``` and ```\nb\n```", "alice");
        const first = nodes[0] as any;
        const second = nodes[2] as any;
        expect(first.type).toBe("pre");
        expect(first.props.children[1].props.children).toBe("a");
        expect(nodes[1]).toBe(" and ");
        expect(second.type).toBe("pre");
        expect(second.props.children[1].props.children).toBe("b");
    });

    it("preserves internal newlines in multi-line code, stripping only the one before the closing fence", () => {
        const nodes = parseMarkdown("```js\nline1\nline2\n```", "alice");
        const pre = nodes[0] as any;
        const codeEl = pre.props.children[1];
        expect(codeEl.props.children).toBe("line1\nline2");
    });
});

describe("parseMarkdown — auto-linkify URLs", () => {
    it("turns a bare https URL into a link", () => {
        const nodes = parseMarkdown("check https://example.com out", "alice");
        expect(nodes[0]).toBe("check ");
        const a = nodes[1] as any;
        expect(a.type).toBe("a");
        expect(a.props.href).toBe("https://example.com");
        expect(a.props.children).toBe("https://example.com");
        expect(a.props.target).toBe("_blank");
        expect(a.props.rel).toBe("noopener noreferrer");
        expect(a.props.className).toBe("dw-link");
        expect(nodes[2]).toBe(" out");
    });

    it("strips a trailing period that isn't part of the URL", () => {
        const nodes = parseMarkdown("see https://example.com.", "alice");
        const a = nodes[1] as any;
        expect(a.props.href).toBe("https://example.com");
        expect(nodes[2]).toBe(".");
    });

    it("keeps a closing paren that's part of a balanced URL", () => {
        const nodes = parseMarkdown(
            "https://en.wikipedia.org/wiki/Rust_(programming_language)",
            "alice",
        );
        const a = nodes[0] as any;
        expect(a.props.href).toBe("https://en.wikipedia.org/wiki/Rust_(programming_language)");
        expect(nodes).toHaveLength(1);
    });

    it("strips a trailing paren that closes surrounding sentence punctuation, not the URL", () => {
        const nodes = parseMarkdown("(see https://example.com)", "alice");
        expect(nodes[0]).toBe("(see ");
        const a = nodes[1] as any;
        expect(a.props.href).toBe("https://example.com");
        expect(nodes[2]).toBe(")");
    });

    it("does not linkify a URL inside a code fence", () => {
        const nodes = parseMarkdown("```\nhttps://example.com\n```", "alice");
        const pre = nodes[0] as any;
        const codeEl = pre.props.children[1];
        expect(typeof codeEl.props.children).toBe("string");
        expect(codeEl.props.children).toBe("https://example.com");
    });

    it("never renders a non-http(s) scheme as a link, even if adjacent text looks URL-like", () => {
        const nodes = parseMarkdown("visit javascript:alert(1) now", "alice");
        expect(nodes).toEqual(["visit javascript:alert(1) now"]);
    });
});

describe("parseMarkdown — cross-feature interactions", () => {
    it("links a URL and renders a fence in the same message", () => {
        const nodes = parseMarkdown("see https://example.com ```js\ncode\n``` end", "alice");
        expect((nodes[1] as any).type).toBe("a");
        expect((nodes[3] as any).type).toBe("pre");
    });

    it("does not let bold markers inside a URL split the link", () => {
        const nodes = parseMarkdown("https://example.com/**a**b", "alice");
        expect((nodes[0] as any).props.href).toBe("https://example.com/**a**b");
    });

    it("leaves a URL inside inline code unlinked", () => {
        const nodes = parseMarkdown("`https://example.com`", "alice");
        expect((nodes[0] as any).type).toBe("code");
    });

    it("accepts a language tag containing non-word characters like c++", () => {
        const nodes = parseMarkdown("```c++\nint x;\n```", "alice");
        const pre = nodes[0] as any;
        expect(pre.type).toBe("pre");
        const langEl = pre.props.children[0];
        expect(langEl.props.children).toBe("c++");
        const codeEl = pre.props.children[1];
        expect(codeEl.props.children).toBe("int x;");
    });
});
