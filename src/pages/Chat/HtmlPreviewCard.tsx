import { useMemo } from "react";

import styles from "./Chat.module.scss";

type HtmlPreviewCardProps = {
  html: string;
  subject?: string;
  fallbackText?: string;
};

function buildSrcDoc(html: string): string {
  const trimmed = html.trim();
  if (/^<!doctype\s+html/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) {
    return trimmed;
  }

  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    "<style>html,body{margin:0;padding:12px;}body{font-family:Arial,sans-serif;line-height:1.45;word-break:break-word;}</style>",
    "</head>",
    `<body>${trimmed}</body>`,
    "</html>",
  ].join("");
}

export function HtmlPreviewCard({ html, subject, fallbackText }: HtmlPreviewCardProps) {
  const srcDoc = useMemo(() => buildSrcDoc(html), [html]);
  const trimmedFallback = fallbackText?.trim();
  const shouldShowFallback = Boolean(trimmedFallback);

  return (
    <div className={styles.htmlPreviewCard}>
      <div className={styles.htmlPreviewHeader}>
        <p className={styles.htmlPreviewTitle}>HTML preview</p>
        {subject ? <p className={styles.htmlPreviewSubject}>{subject}</p> : null}
      </div>

      <iframe
        className={styles.htmlPreviewFrame}
        title={subject ? `HTML preview: ${subject}` : "HTML preview"}
        srcDoc={srcDoc}
        loading="lazy"
        sandbox=""
        referrerPolicy="no-referrer"
      />

      {shouldShowFallback ? (
        <details className={styles.htmlPreviewFallback}>
          <summary>Tool result text</summary>
          <pre>{trimmedFallback}</pre>
        </details>
      ) : null}
    </div>
  );
}
