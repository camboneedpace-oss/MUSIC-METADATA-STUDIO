import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import {
  ClipboardPaste,
  Copy,
  Download,
  FolderOpen,
  Globe,
  Image as ImageIcon,
  Music,
  Pencil,
  Ruler,
  Save,
  Search,
  Sparkles,
  Tag,
  Trash2,
  Wrench,
} from "lucide-react";
import * as React from "react";
import { useStore, useSelectedFiles } from "../lib/store";
import type { LibraryFile } from "../lib/library/types";

export function ContextMenu({ file, children }: { file: LibraryFile; children: React.ReactNode }) {
  const openDialog = useStore((s) => s.openDialog);
  const selection = useStore((s) => s.selection);
  const copyMetadata = useStore((s) => s.copyMetadata);
  const pasteMetadata = useStore((s) => s.pasteMetadata);
  const clipboard = useStore((s) => s.clipboard);
  const discardChanges = useStore((s) => s.discardChanges);
  const selected = useSelectedFiles();
  const many = selection.set.size > 1;

  const run = (fn: () => void) => (e: Event) => {
    e.preventDefault();
    fn();
  };

  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>{children}</ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          className="z-50 min-w-[210px] overflow-hidden rounded-[5px] border border-[var(--line-strong)] bg-[var(--panel)] py-1 shadow-[var(--shadow-pop)]"
          onContextMenu={(e) => e.preventDefault()}
        >
          <Item icon={<Tag size={12} />} onSelect={run(() => openDialog("batch"))}>
            {many ? `Batch Edit ${selection.set.size} Files` : "Edit Tags"}
          </Item>
          <Item icon={<Pencil size={12} />} onSelect={run(() => openDialog("batch"))}>
            Batch Editor
          </Item>

          <Separator />
          <Item icon={<Globe size={12} />} onSelect={run(() => openDialog("lookup"))}>
            Lookup Metadata
          </Item>
          <Item icon={<ImageIcon size={12} />} onSelect={run(() => openDialog("artwork"))}>
            {many ? "Download Artwork for Selection" : "Download Artwork"}
          </Item>
          <Item icon={<Search size={12} />} onSelect={run(() => openDialog("lookup", { file }))}>
            Search by Tags
          </Item>

          <Separator />
          <Item icon={<Sparkles size={12} />} onSelect={run(() => openDialog("rename"))}>
            Rename
          </Item>
          <Item icon={<Ruler size={12} />} onSelect={run(() => openDialog("parse"))}>
            Parse Filename
          </Item>

          <Separator />
          <Item icon={<FolderOpen size={12} />} disabled>
            Open Containing Folder
          </Item>
          <Item icon={<Ruler size={12} />} onSelect={run(() => openDialog("analyzer", { file }))}>
            Analyze Audio
          </Item>

          <Separator />
          <Item icon={<Music size={12} />} onSelect={run(() => openDialog("playlist"))}>
            Create Playlist
          </Item>
          <Item icon={<Download size={12} />} onSelect={run(() => openDialog("export"))}>
            Export Metadata
          </Item>

          <Separator />
          <Item
            icon={<Copy size={12} />}
            onSelect={run(() =>
              copyMetadata(file.id, ["title", "artists", "album", "albumArtists", "genres", "year", "trackNumber", "discNumber", "comment", "label", "composer"]),
            )}
          >
            Copy Metadata
          </Item>
          <Item
            icon={<ClipboardPaste size={12} />}
            disabled={!clipboard}
            onSelect={run(() =>
              pasteMetadata(file.id, ["title", "artists", "album", "albumArtists", "genres", "year", "trackNumber", "discNumber", "comment", "label", "composer"]),
            )}
          >
            Paste Metadata
          </Item>
          <Item icon={<ImageIcon size={12} />} onSelect={run(() => openDialog("artwork", { extract: true }))}>
            Extract Artwork
          </Item>

          <Separator />
          <Item icon={<Wrench size={12} />} onSelect={run(() => openDialog("actions"))}>
            Run Action
          </Item>
          <Item icon={<Save size={12} />} onSelect={run(() => openDialog("preview"))}>
            Preview Changes
          </Item>
          <Item
            icon={<Trash2 size={12} />}
            tone="danger"
            disabled={!selected.some((f) => f.dirty)}
            onSelect={run(() => discardChanges(selection.set.size > 1 ? [...selection.set] : [file.id]))}
          >
            Discard Unsaved Changes
          </Item>
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}

function Item({
  children,
  icon,
  onSelect,
  disabled,
  tone,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onSelect?: (e: Event) => void;
  disabled?: boolean;
  tone?: "danger";
}) {
  return (
    <ContextMenuPrimitive.Item
      disabled={disabled}
      onSelect={onSelect}
      className={`flex cursor-pointer items-center gap-2 px-2.5 py-[4px] text-body outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-[var(--raised)] ${
        tone === "danger" ? "text-[var(--danger)]" : "text-[var(--text)]"
      }`}
    >
      <span className="text-[var(--text-faint)]">{icon}</span>
      {children}
    </ContextMenuPrimitive.Item>
  );
}

function Separator() {
  return <div className="my-1 h-px bg-[var(--line)]" />;
}