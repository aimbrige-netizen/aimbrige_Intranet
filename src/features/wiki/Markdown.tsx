import Link from "next/link";
import {
  classifyWikiLink,
  INLINE_PATTERN,
  parseLinkToken,
} from "@/features/wiki/link";
import { cn } from "@/lib/utils";

/**
 * 최소 마크다운 렌더러 (스펙 14 · 3.2)
 *
 * ⚠ dangerouslySetInnerHTML을 쓰지 않는다.
 * 위키는 전 직원이 쓰는 문서다. 본문을 HTML로 넣는 순간 누구든 스크립트를
 * 심을 수 있고, 그걸 막으려면 새니타이저를 붙여야 하는데 그건 라이브러리
 * 하나와 그 라이브러리의 취약점을 같이 들이는 일이다. 여기서는 파싱 결과를
 * React 엘리먼트로 만들기 때문에 텍스트가 마크업이 될 경로 자체가 없다.
 *
 * 지원하는 것: 제목(#~###), 목록(-, 1.), 인용(>), 코드블록(```),
 * 인라인 코드(`), 굵게(**), 링크([]()). 표·이미지는 아직 없다 —
 * 필요해지면 그때 넣는다.
 */
export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);

  if (blocks.length === 0) {
    return <p className="text-body-sm text-muted">내용이 없습니다.</p>;
  }

  return (
    <div className="space-y-3">
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] };

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // 코드블록은 안쪽을 해석하지 않는다 — 코드에 #이 있어도 제목이 아니다
    if (line.startsWith("```")) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // 닫는 ``` 건너뛰기
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2],
      });
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ kind: "quote", text: body.join("\n") });
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/;
    const numbered = /^\s*\d+\.\s+(.*)$/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const pattern = ordered ? numbered : bullet;
      const items: string[] = [];
      while (i < lines.length && pattern.test(lines[i])) {
        items.push(lines[i].match(pattern)![1]);
        i += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    // 연속한 줄은 한 문단으로 묶는다 — 줄마다 문단이 되면 간격이 과하게 벌어진다
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !/^#{1,3}\s/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !bullet.test(lines[i]) &&
      !numbered.test(lines[i])
    ) {
      body.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: "paragraph", text: body.join("\n") });
  }

  return blocks;
}

function Block({ block }: { block: Block }) {
  switch (block.kind) {
    case "heading": {
      /*
       * 19 → 17 → 15(볼드). 페이지 제목(PageHeader의 h1, 24px)보다 작게
       * 시작한다 — 문서 안의 #은 페이지 제목이 아니라 그 아래 절이다.
       *
       * 처음엔 text-heading을 썼는데 tailwind.config에 없는 토큰이라 CSS가
       * 아예 생성되지 않았고, 그다음 text-title은 24px(h1과 같은 값)이라
       * 두 번 다 #이 ###보다 작게 나왔다. 토큰 이름만 보고 크기를 짐작하면
       * 이렇게 된다.
       */
      const className = cn(
        "text-ink",
        block.level === 1 && "text-h2",
        block.level === 2 && "text-h3",
        block.level === 3 && "text-body font-bold",
      );
      if (block.level === 1) return <h2 className={className}>{block.text}</h2>;
      if (block.level === 2) return <h3 className={className}>{block.text}</h3>;
      return <h4 className={className}>{block.text}</h4>;
    }

    case "code":
      return (
        <pre className="overflow-x-auto rounded-card border border-line bg-subtle p-3">
          <code className="text-micro text-ink">{block.text}</code>
        </pre>
      );

    case "quote":
      return (
        <blockquote className="border-l-2 border-line-strong pl-3 text-body-sm text-muted">
          <Inline text={block.text} />
        </blockquote>
      );

    case "list":
      return block.ordered ? (
        <ol className="ml-5 list-decimal space-y-1 text-body-sm text-ink">
          {block.items.map((item, index) => (
            <li key={index}>
              <Inline text={item} />
            </li>
          ))}
        </ol>
      ) : (
        <ul className="ml-5 list-disc space-y-1 text-body-sm text-ink">
          {block.items.map((item, index) => (
            <li key={index}>
              <Inline text={item} />
            </li>
          ))}
        </ul>
      );

    default:
      return (
        <p className="whitespace-pre-wrap text-body-sm leading-relaxed text-ink">
          <Inline text={block.text} />
        </p>
      );
  }
}

/**
 * 인라인 서식 — 굵게 · 코드 · 링크.
 *
 * 링크는 우리 도메인 안이면 Link로, 밖이면 새 탭 + rel="noopener noreferrer".
 * javascript: 같은 스킴은 아예 링크로 만들지 않고 글자로 남긴다 —
 * 위키는 아무나 쓰는 곳이라 주소도 신뢰할 수 없는 입력이다.
 */
function Inline({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  // 패턴은 link.ts에 있다 — 주소의 괄호 처리를 검증할 수 있어야 해서 뺐다
  const pattern = new RegExp(INLINE_PATTERN.source, "g");

  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];

    if (token.startsWith("**")) {
      parts.push(
        <strong key={match.index} className="font-bold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      parts.push(
        <code
          key={match.index}
          className="rounded-sm bg-subtle px-1 py-0.5 text-micro text-ink"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      const link = parseLinkToken(token);
      // 패턴이 잡았으면 항상 파싱되지만, 안 되면 원문을 그대로 남긴다
      parts.push(
        link ? (
          <Anchor key={match.index} label={link.label} href={link.href} />
        ) : (
          token
        ),
      );
    }

    last = match.index + token.length;
  }

  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function Anchor({ label, href }: { label: string; href: string }) {
  /*
   * 스킴 판정은 link.ts에 있다. 이 판정이 틀리면 피싱 링크가 그대로 살아나는데
   * JSX 안에 있으면 렌더링 없이 확인할 수 없어서 순수 함수로 뺐다.
   * 위험한 스킴(javascript:, data: 등)과 프로토콜 상대 URL은 링크로 만들지 않는다.
   */
  const kind = classifyWikiLink(href);

  if (kind === "unsafe") {
    return <span className="text-ink">{label}</span>;
  }

  const className = "text-primary underline underline-offset-2";

  return kind === "internal" ? (
    <Link href={href} className={className}>
      {label}
    </Link>
  ) : (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {label}
    </a>
  );
}
