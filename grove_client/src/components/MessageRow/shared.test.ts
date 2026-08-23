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
