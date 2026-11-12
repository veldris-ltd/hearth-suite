/**
 * Toast runtime host (DSG-C3).
 *
 * A singleton `aria-live` region that stacks transient `h-toast` notifications.
 * Toasts auto-dismiss (pausing while hovered), can be closed by keyboard, and
 * animate with the motion tokens. Variants follow the v1.0 set:
 * success / seal / danger / warning (+ a neutral info default).
 */

import { icon, type IconName } from "@hearth/design-system";

export type ToastVariant = "success" | "seal" | "danger" | "warning" | "info";

export interface ToastOptions {
  variant?: ToastVariant;
  /** ms before auto-dismiss; 0 keeps it until closed. Default 5000 (8000 danger). */
  duration?: number;
  /** Optional bold title shown above the message. */
  title?: string;
}

const ICONS: Record<ToastVariant, IconName> = {
  success: "check",
  seal: "seal",
  danger: "alert",
  warning: "alert",
  info: "info",
};

let host: HTMLElement | null = null;

function ensureHost(): HTMLElement {
  if (host && host.isConnected) {
    return host;
  }
  host = document.createElement("div");
  host.className = "hb-toast-host";
  host.setAttribute("aria-live", "polite");
  host.setAttribute("aria-atomic", "false");
  document.body.append(host);
  return host;
}

/**
 * Show a toast. Returns a function that dismisses it early.
 */
export function toast(message: string, opts: ToastOptions = {}): () => void {
  const variant = opts.variant ?? "info";
  const duration = opts.duration ?? (variant === "danger" ? 8000 : 5000);
  const root = ensureHost();

  const node = document.createElement("div");
  node.className = `hb-toast hb-toast--${variant}`;
  node.setAttribute("role", variant === "danger" ? "alert" : "status");

  const glyph = document.createElement("span");
  glyph.className = "hb-toast__icon";
  glyph.innerHTML = icon(ICONS[variant], 18);

  const body = document.createElement("div");
  body.className = "hb-toast__body";
  if (opts.title) {
    const title = document.createElement("div");
    title.className = "hb-toast__title";
    title.textContent = opts.title;
    body.append(title);
  }
  const msg = document.createElement("div");
  msg.className = "hb-toast__msg";
  msg.textContent = message;
  body.append(msg);

  const close = document.createElement("button");
  close.className = "hb-toast__close";
  close.type = "button";
  close.setAttribute("aria-label", "Dismiss notification");
  close.innerHTML = icon("x", 16);

  node.append(glyph, body, close);
  root.append(node);
  // Trigger the enter transition on the next frame.
  requestAnimationFrame(() => node.classList.add("is-in"));

  let timer: ReturnType<typeof setTimeout> | undefined;
  let dismissed = false;

  const remove = (): void => {
    node.remove();
    if (host && host.childElementCount === 0) {
      host.remove();
      host = null;
    }
  };
  const dismiss = (): void => {
    if (dismissed) {
      return;
    }
    dismissed = true;
    if (timer) {
      clearTimeout(timer);
    }
    node.classList.remove("is-in");
    node.classList.add("is-out");
    node.addEventListener("transitionend", remove, { once: true });
    // Fallback if the transition never fires (reduced motion / detached tab).
    setTimeout(remove, 500);
  };
  const arm = (): void => {
    if (duration > 0) {
      timer = setTimeout(dismiss, duration);
    }
  };

  // Pause on hover; resume on leave.
  node.addEventListener("mouseenter", () => {
    if (timer) {
      clearTimeout(timer);
    }
  });
  node.addEventListener("mouseleave", arm);
  close.addEventListener("click", dismiss);
  arm();

  return dismiss;
}
