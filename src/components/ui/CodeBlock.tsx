interface CodeBlockProps {
  code: string;
  /* Shown as a mono caption above the block. */
  caption?: string;
  className?: string;
}

export default function CodeBlock({ code, caption, className = "" }: CodeBlockProps) {
  return (
    <div className={className}>
      {caption ? (
        <div className="meta" style={{ marginBottom: "var(--space-2)" }}>
          {caption}
        </div>
      ) : null}
      <pre className="code">
        <code>{code}</code>
      </pre>
    </div>
  );
}
