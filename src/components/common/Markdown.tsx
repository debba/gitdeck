import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownProps {
  children: string;
  baseUrl?: string;
  className?: string;
}

function resolveMarkdownUrl(url: string, baseUrl?: string): string {
  const safeUrl = defaultUrlTransform(url);
  if (!safeUrl || !baseUrl || /^[a-z][a-z\d+.-]*:/i.test(safeUrl) || safeUrl.startsWith("//")) return safeUrl;

  try {
    return new URL(safeUrl, `${baseUrl.replace(/\/$/, "")}/`).href;
  } catch {
    return safeUrl;
  }
}

export function Markdown({ children, baseUrl, className = "" }: MarkdownProps) {
  return (
    <div className={`markdown-body ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => resolveMarkdownUrl(url, baseUrl)}
        components={{
          a: ({ children: linkChildren, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer">{linkChildren}</a>
          ),
          img: (props) => <img {...props} loading="lazy" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
