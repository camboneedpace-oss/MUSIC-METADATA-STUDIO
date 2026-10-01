import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { X } from "lucide-react";
import * as React from "react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ================================================================
   Buttons
   ================================================================ */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "outline" | "danger" | "ghost-danger";
  size?: "sm" | "md" | "lg";
  /** Square, icon-only. Keep an accessible label on these. */
  icon?: boolean;
};

export function Button({
  variant = "default",
  size = "md",
  icon = false,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "btn",
        variant === "primary" && "btn-primary",
        variant === "outline" && "btn-outline",
        variant === "danger" && "btn-danger",
        variant === "ghost-danger" && "btn-ghost-danger",
        size === "sm" && "btn-sm",
        size === "lg" && "btn-lg",
        icon && "btn-icon",
        className,
      )}
      {...props}
    />
  );
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className={cn("btn btn-icon", className)}
            {...props}
          >
            {children}
          </button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/* ================================================================
   Dialog
   ================================================================ */

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 760,
  icon,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  icon?: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="animate-overlay-in fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          style={{ width }}
          className="animate-dialog-in fixed left-1/2 top-1/2 z-50 flex max-h-[86vh] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line-strong)] bg-[var(--panel)] shadow-[var(--shadow-pop)] focus:outline-none"
        >
          <header className="hairline-t flex shrink-0 items-start gap-3 border-b border-[var(--line)] bg-[linear-gradient(180deg,var(--panel-2),var(--panel))] px-5 py-3.5">
            {icon ? (
              <span className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--chassis)] text-[var(--accent)]">
                {icon}
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-[13.5px] font-semibold tracking-tight">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-0.5 text-[11.5px] leading-snug text-[var(--text-dim)]">
                  {description}
                </DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="btn btn-icon h-7 w-7 shrink-0"
              >
                <X size={14} />
              </button>
            </DialogPrimitive.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-auto">{children}</div>

          {footer ? (
            <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--line)] bg-[var(--panel-2)] px-5 py-3">
              {footer}
            </footer>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ================================================================
   Tooltip
   ================================================================ */

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  children,
  side = "bottom",
  className,
}: {
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        side={side}
        sideOffset={6}
        className={cn(
          "z-[60] max-w-[280px] rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--raised)] px-2 py-1 text-[11px] leading-snug text-[var(--text)] shadow-[var(--shadow-md)]",
          className,
        )}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

/* ================================================================
   Form fields
   ================================================================ */

/**
 * `Field` wires the label to its control via `htmlFor`. Pass the input `id`
 * through `controlId` so clicking the label focuses the right element.
 */
export function Field({
  label,
  hint,
  children,
  className,
  controlId,
  trailing,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
  controlId?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={controlId} className="label-xs">
          {label}
        </label>
        {trailing}
      </div>
      {children}
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  indeterminate,
  disabled,
  className,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  indeterminate?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer select-none items-center gap-2",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <CheckboxPrimitive.Root
        checked={indeterminate ? "indeterminate" : checked}
        disabled={disabled}
        aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}
        onCheckedChange={(v) => onChange(v === true)}
        className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] border border-[var(--line-strong)] bg-[var(--chassis)] transition-colors hover:border-[var(--text-faint)] data-[state=checked]:border-[var(--accent)] data-[state=checked]:bg-[var(--accent)] data-[state=indeterminate]:border-[var(--accent)] data-[state=indeterminate]:bg-[var(--accent)]"
      >
        <CheckboxPrimitive.Indicator className="text-[var(--accent-fg)]">
          {indeterminate ? (
            <span className="block h-[1.5px] w-[7px] bg-[var(--accent-fg)]" />
          ) : (
            <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2.4}>
              <path d="M2.6 6.2 4.9 8.5 9.4 3.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label ? <span className="text-[12px] leading-tight text-[var(--text-dim)]">{label}</span> : null}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <SwitchPrimitive.Root
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        className="relative h-[17px] w-[30px] shrink-0 rounded-full border border-[var(--line-strong)] bg-[var(--chassis)] transition-colors hover:border-[var(--text-faint)] data-[state=checked]:border-[var(--accent)] data-[state=checked]:bg-[var(--accent)]"
      >
        <SwitchPrimitive.Thumb className="block h-[11px] w-[11px] translate-x-[2px] rounded-full bg-[var(--text-dim)] transition-transform data-[state=checked]:translate-x-[15px] data-[state=checked]:bg-[var(--accent-fg)]" />
      </SwitchPrimitive.Root>
      {label ? <span className="text-[12px] text-[var(--text-dim)]">{label}</span> : null}
    </div>
  );
}

/* ================================================================
   Display primitives
   ================================================================ */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      {icon ? (
        <div className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--panel-2)] text-[var(--text-faint)]">
          {icon}
        </div>
      ) : null}
      <h3 className="text-[14px] font-semibold tracking-tight">{title}</h3>
      {description ? (
        <p className="max-w-[48ch] text-[12px] leading-relaxed text-[var(--text-dim)]">{description}</p>
      ) : null}
      {action}
    </div>
  );
}

const TONES = {
  neutral: "border-[var(--line-strong)] text-[var(--text-dim)]",
  ok: "border-[color-mix(in_oklab,var(--ok)_42%,transparent)] text-[var(--ok)]",
  warn: "border-[color-mix(in_oklab,var(--warn)_42%,transparent)] text-[var(--warn)]",
  danger: "border-[color-mix(in_oklab,var(--danger)_42%,transparent)] text-[var(--danger)]",
  accent: "border-[var(--accent-line)] text-[var(--accent)]",
} as const;

export function Badge({
  children,
  tone = "neutral",
  title,
  dot,
}: {
  children: React.ReactNode;
  tone?: keyof typeof TONES;
  title?: string;
  dot?: boolean;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium uppercase tracking-[0.05em]",
        TONES[tone],
      )}
    >
      {dot ? <span className="h-1 w-1 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

export function ProgressBar({ value, tone = "accent" }: { value: number; tone?: string }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div className="h-[3px] w-full overflow-hidden rounded-full bg-[var(--raised)]">
      <div
        className="h-full rounded-full transition-[width] duration-200 ease-out"
        style={{
          width: `${pct}%`,
          background: tone === "accent" ? "var(--accent)" : `var(--${tone})`,
        }}
      />
    </div>
  );
}

export function Segmented<T extends string | number | boolean>({
  options,
  value,
  onChange,
  className,
}: {
  options: Array<{ value: T; label: string; title?: string }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      className={cn(
        "inline-flex overflow-hidden rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--chassis)] p-px",
        className,
      )}
    >
      {options.map((option, i) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            title={option.title}
            onClick={() => onChange(option.value)}
            data-active={active}
            className={cn(
              "h-[22px] px-2.5 text-[11px] font-medium text-[var(--text-dim)] transition-all duration-150",
            i > 0 ? "ml-px" : null,
              active
                ? "rounded-[var(--radius-xs)] bg-[var(--accent-soft)] text-[var(--accent)] shadow-[var(--ring-inset)]"
                : "hover:bg-[var(--raised)] hover:text-[var(--text)]",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function useDebounced<T>(value: T, delay = 180): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}