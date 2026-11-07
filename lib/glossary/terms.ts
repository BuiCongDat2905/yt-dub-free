export interface TermSpan {
  term: string;
  start: number;
  end: number;
}

export interface ProtectedText {
  masked: string;
  terms: string[];
}

export interface MixedSegment {
  text: string;
  lang: "vi" | "en";
}

/**
 * Thuật ngữ CNTT giữ nguyên tiếng Anh khi dịch, rồi đọc bằng giọng Anh.
 * Gồm nhóm lập trình/web và AI/dữ liệu.
 */
export const GLOSSARY: string[] = [
  // lập trình / web
  "JavaScript",
  "TypeScript",
  "Node.js",
  "Next.js",
  "Nuxt.js",
  "Vue.js",
  "React",
  "Angular",
  "Svelte",
  "jQuery",
  "Redux",
  "HTML",
  "CSS",
  "SCSS",
  "JSON",
  "XML",
  "YAML",
  "AJAX",
  "REST",
  "GraphQL",
  "API",
  "SDK",
  "CLI",
  "IDE",
  "URL",
  "URI",
  "HTTP",
  "HTTPS",
  "WebSocket",
  "CORS",
  "JWT",
  "OAuth",
  "CRUD",
  "MVC",
  "DOM",
  "SPA",
  "SSR",
  "SSG",
  "npm",
  "pnpm",
  "yarn",
  "webpack",
  "Vite",
  "Babel",
  "ESLint",
  "Prettier",
  "Git",
  "GitHub",
  "GitLab",
  "Docker",
  "Kubernetes",
  "CI/CD",
  "DevOps",
  "SQL",
  "MySQL",
  "PostgreSQL",
  "MongoDB",
  "Redis",
  "SQLite",
  "Python",
  "Java",
  "Kotlin",
  "Swift",
  "Golang",
  "Rust",
  "PHP",
  "Ruby",
  "C++",
  "C#",
  ".NET",
  "API",
  "RESTful",
  "server",
  "client",
  "backend",
  "frontend",
  "database",
  "schema",
  "query",
  "queries",
  "index",
  "cache",
  "caches",
  "commit",
  "commits",
  "branch",
  "branches",
  "merge",
  "deploy",
  "deployment",
  "build",
  "builds",
  "debug",
  "bug",
  "bugs",
  "log",
  "logs",
  "thread",
  "threads",
  "process",
  "container",
  "containers",
  "microservice",
  "monolith",
  "framework",
  "frameworks",
  "library",
  "libraries",
  "runtime",
  "compiler",
  "interpreter",
  "function",
  "functions",
  "method",
  "methods",
  "class",
  "classes",
  "object",
  "objects",
  "array",
  "arrays",
  "string",
  "strings",
  "integer",
  "boolean",
  "variable",
  "constant",
  "loop",
  "recursion",
  "algorithm",
  "complexity",
  "stack",
  "queue",
  "hash",
  "encryption",
  "token",
  "tokens",
  "session",
  "sessions",
  "cookie",
  "cookies",
  "request",
  "requests",
  "response",
  "responses",
  "endpoint",
  "endpoints",
  "payload",
  "middleware",
  "router",
  "component",
  "components",
  "hook",
  "hooks",
  "props",
  "state",
  "render",
  "bundle",
  "refactor",
  "test",
  "tests",
  "unit test",
  "framework",
  // AI / dữ liệu
  "AI",
  "ML",
  "LLM",
  "GPT",
  "machine learning",
  "deep learning",
  "neural network",
  "model",
  "models",
  "dataset",
  "datasets",
  "training",
  "inference",
  "embedding",
  "embeddings",
  "vector",
  "vectors",
  "prompt",
  "prompts",
  "transformer",
  "attention",
  "fine-tune",
  "overfitting",
  "gradient",
  "loss",
  "epoch",
  "batch",
  "label",
  "labels",
  "feature",
  "features",
  "pipeline",
  "preprocessing",
  "accuracy",
  "precision",
  "recall",
  "classification",
  "regression",
  "cluster",
  "clustering",
  "GPU",
  "CPU",
  "RAM",
];

const UNIQUE_TERMS = Array.from(new Set(GLOSSARY)).sort((a, b) => b.length - a.length);

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const TERM_PATTERN = new RegExp(
  `(?<![A-Za-z0-9_])(${UNIQUE_TERMS.map(escapeRegExp).join("|")})(?![A-Za-z0-9_])`,
  "gi",
);

/** Tìm mọi thuật ngữ tiếng Anh trong câu. */
export function findTermSpans(text: string): TermSpan[] {
  const spans: TermSpan[] = [];
  TERM_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TERM_PATTERN.exec(text)) !== null) {
    const term = match[0];
    if (term.length === 0) break;
    spans.push({ term, start: match.index, end: match.index + term.length });
  }
  return spans;
}

export function containsEnglishTerm(text: string): boolean {
  TERM_PATTERN.lastIndex = 0;
  return TERM_PATTERN.test(text);
}

/**
 * Thay thuật ngữ bằng token đánh dấu trước khi dịch, để Google Translate không dịch chúng.
 * Token dạng `[[0]]` — Google giữ nguyên (đã kiểm chứng bằng probe).
 */
export function protectTerms(text: string): ProtectedText {
  const spans = findTermSpans(text);
  if (spans.length === 0) return { masked: text, terms: [] };

  const terms: string[] = [];
  let masked = "";
  let cursor = 0;
  for (const span of spans) {
    masked += text.slice(cursor, span.start);
    const index = terms.length;
    terms.push(span.term);
    masked += `[[${index}]]`;
    cursor = span.end;
  }
  masked += text.slice(cursor);
  return { masked, terms };
}

/** Hoàn lại thuật ngữ gốc sau khi dịch. */
export function restoreTerms(masked: string, terms: string[]): string {
  if (terms.length === 0) return masked;
  return masked.replace(/\[\[(\d+)\]\]/g, (token, indexText: string) => {
    const index = Number(indexText);
    return Number.isInteger(index) && terms[index] !== undefined ? terms[index] : token;
  });
}

function buildSegments(text: string, spans: TermSpan[]): MixedSegment[] {
  const segments: MixedSegment[] = [];
  const push = (value: string, lang: "vi" | "en"): void => {
    const trimmed = value.trim();
    if (trimmed === "") return;
    const last = segments[segments.length - 1];
    if (last && last.lang === lang) last.text = `${last.text} ${trimmed}`;
    else segments.push({ text: trimmed, lang });
  };

  let cursor = 0;
  for (const span of spans) {
    push(text.slice(cursor, span.start), "vi");
    push(span.term, "en");
    cursor = span.end;
  }
  push(text.slice(cursor), "vi");
  return segments;
}

/**
 * Chia câu thành đoạn Việt/Anh để đọc đúng giọng.
 * `domains`: đoạn tiếng Anh là thuật ngữ CNTT; `vi`: phần còn lại.
 */
export function splitMixedSegments(text: string): MixedSegment[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized === "") return [];
  return buildSegments(normalized, findTermSpans(normalized));
}
