/**
 * Export Studio.
 *
 * A tiny template language rather than a per-format renderer:
 *
 *   {{field}}                 value
 *   {{#tracks}}…{{/tracks}}   repeat block
 *   {{^missing}}…{{/missing}}  run when the value is empty
 *
 * That covers CSV, JSON, XML, HTML, Markdown, RTF and TXT from one engine,
 * and it means a user template can express exactly what a built-in can.
 */

import { formatBytes, formatDuration } from "../metadata/types";
import type { LibraryFile } from "../library/types";

export type ExportFormat = "csv" | "json" | "xml" | "html" | "markdown" | "rtf" | "txt";

export const EXPORT_FORMATS: Array<{ id: ExportFormat; label: string; extension: string }> = [
  { id: "csv", label: "CSV", extension: ".csv" },
  { id: "json", label: "JSON", extension: ".json" },
  { id: "xml", label: "XML", extension: ".xml" },
  { id: "html", label: "HTML report", extension: ".html" },
  { id: "markdown", label: "Markdown", extension: ".md" },
  { id: "rtf", label: "RTF", extension: ".rtf" },
  { id: "txt", label: "Plain text", extension: ".txt" },
];

export type ExportScope = "selection" | "filtered" | "all";

export interface ExportTemplate {
  id: string;
  name: string;
  format: ExportFormat;
  template: string;
  /** Built-ins that are cheaper to produce directly than through the template. */
  build?: (files: LibraryFile[], ctx: RenderContext) => string;
  builtIn?: boolean;
}

export interface ExportOptions {
  scope: ExportScope;
  /** Include the artwork byte count in the output. */
  includeTechnical: boolean;
  delimiter: string;
  /** Files per row block for HTML/Markdown reports. */
  groupByAlbum: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  scope: "filtered",
  includeTechnical: true,
  delimiter: ",",
  groupByAlbum: true,
};

/* ---------- built-in templates ---------- */

const COLUMN_HEADERS: Array<[string, string]> = [
  ["Filename", "filename"],
  ["Title", "title"],
  ["Artist", "artist"],
  ["Album Artist", "albumartist"],
  ["Album", "album"],
  ["Track", "track"],
  ["Track Total", "tracktotal"],
  ["Disc", "disc"],
  ["Year", "year"],
  ["Genre", "genre"],
  
  ["Composer", "composer"],
  ["BPM", "bpm"],
  ["Key", "key"],
  ["Comment", "comment"],
  ["Format", "format"],
  ["Duration", "duration"],
  ["Bitrate", "bitrate"],
  ["Sample Rate", "samplerate"],
  ["Channels", "channels"],
  ["Bit Depth", "bitdepth"],
  ["File Size", "size"],
  ["Folder", "folder"],
  ["ISRC", "isrc"],
  ["Barcode", "barcode"],
  ["Catalog Number", "catalog"],
  ["Modified", "modified"],
  ["Tag Status", "tagstatus"],
];

export const BUILTIN_TEMPLATES: ExportTemplate[] = [
  {
    id: "csv-all",
    name: "CSV — all columns",
    format: "csv",
    builtIn: true,
    template: COLUMN_HEADERS.map(([, key]) => `{{${key}}}`).join("{{delimiter}}"),
  },
  {
    id: "csv-basic",
    name: "CSV — basic tags",
    format: "csv",
    builtIn: true,
    template: "Artist,Album,Track,Title,Year,Genre",
  },
  {
    id: "json-manifest",
    name: "JSON — manifest",
    format: "json",
    builtIn: true,
    template: "{{#tracks}}{{title}} — {{artist}}\n{{/tracks}}",
    build: (files, ctx) =>
      JSON.stringify(
        {
          generator: "Universal Music Metadata Studio",
          exported: ctx.exportedAt.toISOString(),
          totals: {
            files: files.length,
            albums: new Set(files.map((f) => f.metadata.album).filter(Boolean)).size,
            artists: new Set(files.flatMap((f) => f.metadata.artists ?? [])).size,
            bytes: files.reduce((n, f) => n + f.size, 0),
          },
          tracks: files.map((f) => fileToObject(f)),
        },
        null,
        2,
      ),
  },
  {
    id: "xml-manifest",
    name: "XML — manifest",
    format: "xml",
    builtIn: true,
    template: `<musicmetadata>
  <files count="{{count}}">
{{#tracks}}    <track>
      <title>{{title}}</title>
      <artist>{{artist}}</artist>
      <album>{{album}}</album>
      <track>{{track}}</track>
      <year>{{year}}</year>
      <genre>{{genre}}</genre>
      <duration>{{duration}}</duration>
      <format>{{format}}</format>
    </track>
{{/tracks}}  </files>
</musicmetadata>`,
  },
  {
    id: "html-report",
    name: "HTML — library report",
    format: "html",
    builtIn: true,
    template: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Library report</title>
<style>
  body { font: 13px/1.5 Inter, system-ui, sans-serif; margin: 32px; color: #16181d; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #6b7280; margin-bottom: 20px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 5px 10px 5px 0; border-bottom: 1px solid #e5e7eb; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; }
  .num { font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
<h1>Library report</h1>
<div class="meta">{{count}} files · exported {{exported}}</div>
<table>
<thead><tr><th>#</th><th>Title</th><th>Artist</th><th>Album</th><th>Length</th><th>Format</th></tr></thead>
<tbody>
{{#tracks}}<tr>
  <td class="num">{{index}}</td>
  <td>{{title}}</td>
  <td>{{artist}}</td>
  <td>{{album}}</td>
  <td class="num">{{duration}}</td>
  <td>{{format}}</td>
</tr>
{{/tracks}}</tbody>
</table>
</body>
</html>`,
  },
  {
    id: "markdown-report",
    name: "Markdown — album listing",
    format: "markdown",
    builtIn: true,
    template: `# Library report

Exported {{exported}} · {{count}} files

| # | Title | Artist | Album | Length | Format |
|---|-------|--------|-------|--------|--------|
{{#tracks}}| {{index}} | {{title}} | {{artist}} | {{album}} | {{duration}} | {{format}} |
{{/tracks}}`,
  },
  {
    id: "rtf-report",
    name: "RTF — plain listing",
    format: "rtf",
    builtIn: true,
    template: `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Inter;}}
\\fs20
\\b Library report\\b0\\par
{{#tracks}}{{index}}. {{artist}} — {{title}} ({{duration}})\\par
{{/tracks}}}`,
  },
  {
    id: "txt-report",
    name: "Text — artist listing",
    format: "txt",
    builtIn: true,
    template: `{{#tracks}}{{artist}} — {{title}}
{{/tracks}}`,
  },
];

export const CSV_HEADERS = COLUMN_HEADERS.map(([label]) => label);

const COLUMN_KEYS = Object.fromEntries(COLUMN_HEADERS) as Record<string, string>;

export function fileToObject(file: LibraryFile, technical = true): Record<string, unknown> {
  const m = file.metadata;
  const base: Record<string, unknown> = {
    filename: file.name,
    title: m.title ?? "",
    artist: (m.artists ?? (m.artist ? [m.artist] : [])).join("; "),
    albumartist: (m.albumArtists ?? (m.albumArtist ? [m.albumArtist] : [])).join("; "),
    album: m.album ?? "",
    track: m.trackNumber ?? "",
    tracktotal: m.trackTotal ?? "",
    disc: m.discNumber ?? "",
    disctotal: m.discTotal ?? "",
    year: m.year ?? "",
    date: m.date ?? "",
    genre: (m.genres ?? (m.genre ? [m.genre] : [])).join("; "),
    label: m.label ?? "",
    composer: (m.composers ?? (m.composer ? [m.composer] : [])).join("; "),
    conductor: m.conductor ?? "",
    bpm: m.bpm ?? "",
    key: m.key ?? "",
    comment: m.comment ?? "",
    grouping: m.grouping ?? "",
    copyright: m.copyright ?? "",
    isrc: m.isrc ?? "",
    barcode: m.barcode ?? "",
    catalog: m.catalogNumber ?? "",
    compilation: m.compilation ? "1" : "",
  };
  if (technical) {
    Object.assign(base, {
      format: file.format,
      duration: file.audio.duration !== undefined ? Math.round(file.audio.duration) : "",
      durationText: formatDuration(file.audio.duration),
      bitrate: file.audio.bitrate ?? "",
      samplerate: file.audio.sampleRate ?? "",
      channels: file.audio.channels ?? "",
      bitdepth: file.audio.bitDepth ?? "",
      codec: file.audio.codec ?? "",
      lossless: file.audio.lossless ? "1" : "",
      size: file.size,
      sizeText: formatBytes(file.size),
      folder: file.folder,
      path: `${file.folder}/${file.name}`,
      modified: new Date(file.modifiedAt).toISOString().slice(0, 19).replace("T", " "),
      tagstatus: file.tagStatus,
      artwork: (m.artwork ?? []).length,
    });
  }
  for (const [k, v] of Object.entries(m.customFields ?? {})) {
    base[`custom_${k}`] = v;
  }
  return base;
}

/* ---------- the template engine ---------- */

function flattenObject(obj: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k.toLowerCase()] = Array.isArray(v) ? v.join("; ") : String(v ?? "");
  }
  return out;
}

export interface RenderContext {
  delimiter: string;
  exportedAt: Date;
}

export function renderTemplate(template: string, files: LibraryFile[], ctx: RenderContext): string {
  // Handle the repeating block first so inner placeholders stay simple.
  const withBlock = template.replace(
    /\{\{#tracks\}\}([\s\S]*?)\{\{\/tracks\}\}/g,
    (_, body: string) =>
      files
        .map((file, i) =>
          renderScalar(body, {
            ...fileToObject(file),
            index: i + 1,
            exported: ctx.exportedAt.toISOString().slice(0, 19).replace("T", " "),
            count: files.length,
            delimiter: ctx.delimiter,
          }),
        )
        .join(ctx.delimiter === "\n" ? "\n" : ""),
  );

  return renderScalar(withBlock, {
    count: files.length,
    exported: ctx.exportedAt.toISOString().slice(0, 19).replace("T", " "),
    albums: new Set(files.map((f) => f.metadata.album).filter(Boolean)).size,
    artists: new Set(files.flatMap((f) => f.metadata.artists ?? [])).size,
    bytes: files.reduce((n, f) => n + f.size, 0),
    sizeText: formatBytes(files.reduce((n, f) => n + f.size, 0)),
    durationText: formatDuration(files.reduce((n, f) => n + (f.audio.duration ?? 0), 0)),
    delimiter: ctx.delimiter,
  });
}

function renderScalar(template: string, values: Record<string, unknown>): string {
  const flat = flattenObject(values);
  return template
    .replace(/\{\{\^(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key: string, body: string) =>
      flat[key.toLowerCase()] ? "" : body,
    )
    .replace(/\{\{\{([\w.]+)\}\}\}/g, (_, key: string) => flat[key.toLowerCase()] ?? "")
    .replace(/\{\{([\w.]+)\}\}/g, (_, key: string) => {
      const v = flat[key.toLowerCase()];
      return v === undefined ? "" : v;
    });
}

/* ---------- exporters ---------- */

function csvCell(value: unknown, delimiter: string): string {
  const s = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  if (s.includes(delimiter) || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(files: LibraryFile[], options: ExportOptions): string {
  const columns = options.includeTechnical ? CSV_HEADERS : CSV_HEADERS.slice(0, 16);
  const lines = [columns.map((c) => csvCell(c, options.delimiter)).join(options.delimiter)];
  for (const file of files) {
    const obj = fileToObject(file, options.includeTechnical) as Record<string, unknown>;
    lines.push(
      columns
        .map((col) => csvCell(obj[COLUMN_KEYS[col] ?? col.toLowerCase()], options.delimiter))
        .join(options.delimiter),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

export function runExport(
  files: LibraryFile[],
  template: ExportTemplate,
  options: ExportOptions,
  exportedAt = new Date(),
): string {
  const ctx: RenderContext = { delimiter: options.delimiter, exportedAt };
  if (template.format === "csv" && template.builtIn) return toCsv(files, options);
  if (template.build) return template.build(files, ctx);
  return renderTemplate(template.template, files, ctx);
}

export function downloadText(filename: string, content: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const MIME_BY_FORMAT: Record<ExportFormat, string> = {
  csv: "text/csv;charset=utf-8",
  json: "application/json;charset=utf-8",
  xml: "application/xml;charset=utf-8",
  html: "text/html;charset=utf-8",
  markdown: "text/markdown;charset=utf-8",
  rtf: "application/rtf;charset=utf-8",
  txt: "text/plain;charset=utf-8",
};