import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/* Distance kept from the window edges, and from the anchor row. */
const EDGE = 12;
const GAP = 8;

/**
 * Hover intent with an open delay, so sweeping the pointer across a list
 * never flashes a card. Also exposes keyboard-friendly open/close.
 */
export function useHoverIntent({
  enabled = true,
  openDelay = 380,
  closeDelay = 120,
} = {}) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const show = useCallback(() => {
    if (!enabled) return;
    clear();
    timerRef.current = window.setTimeout(() => setOpen(true), openDelay);
  }, [clear, enabled, openDelay]);

  const hide = useCallback(() => {
    clear();
    timerRef.current = window.setTimeout(() => setOpen(false), closeDelay);
  }, [clear, closeDelay]);

  const hideNow = useCallback(() => {
    clear();
    setOpen(false);
  }, [clear]);

  useEffect(() => clear, [clear]);

  useEffect(() => {
    if (!enabled) hideNow();
  }, [enabled, hideNow]);

  return { open, show, hide, hideNow };
}

/**
 * Portal-rendered card anchored above (preferred) or below an element.
 *
 * `variant="row"` follows the nearest task row so a long-text preview remains
 * visually attached to its source. `variant="fit"` measures its own content
 * first and then centres itself on the anchor.
 */
function HoverCard({
  anchorRef,
  open,
  variant = "block",
  className = "",
  boundsSelector,
  minSpace = 88,
  interactive = false,
  onRequestClose,
  onPointerEnter,
  onPointerLeave,
  style: customStyle,
  children,
}) {
  const cardRef = useRef(null);
  const [pos, setPos] = useState(null);

  const isFit = variant === "fit";
  const isRow = variant === "row";

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }

    const anchor = anchorRef?.current;
    if (!anchor) return;

    const anchorRect = anchor.getBoundingClientRect();
    const rowRect = isRow
      ? anchor.closest(".todo")?.getBoundingClientRect?.()
      : null;
    const placementRect = rowRect ?? anchorRect;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const bounds = boundsSelector
      ? anchor.closest(boundsSelector)?.getBoundingClientRect?.()
      : null;

    const topLimit = bounds ? Math.max(EDGE, bounds.top) : EDGE;
    const bottomLimit = bounds ? Math.min(vh - EDGE, bounds.bottom) : vh - EDGE;

    const placementGap = isRow ? 6 : GAP;
    const spaceAbove = placementRect.top - topLimit - placementGap;
    const spaceBelow = bottomLimit - placementRect.bottom - placementGap;

    // Prefer above (that is where the user asked for it); fall back to
    // whichever side actually has more room.
    const placeUp = spaceAbove >= minSpace || spaceAbove >= spaceBelow;

    let left = EDGE;
    let width = vw - EDGE * 2;

    if (isRow && rowRect) {
      width = Math.min(rowRect.width, vw - EDGE * 2);
      left = Math.max(EDGE, Math.min(rowRect.left, vw - EDGE - width));
    } else if (isFit) {
      // Measured on the invisible first pass so the card can be centred
      // without a CSS translate fighting the JS-computed left.
      const measured = cardRef.current?.getBoundingClientRect?.().width ?? 0;
      if (!measured) {
        setPos({ measuring: true, placeUp, left: EDGE, top: -9999 });
        return;
      }
      width = null;
      left = Math.max(
        EDGE,
        Math.min(
          anchorRect.left + anchorRect.width / 2 - measured / 2,
          vw - EDGE - measured,
        ),
      );
    }

    const availableSpace = placeUp ? spaceAbove : spaceBelow;
    const maxHeight = isRow
      ? Math.min(120, Math.max(56, availableSpace))
      : Math.max(minSpace, availableSpace);
    const arrowLeft = isRow
      ? Math.max(
          18,
          Math.min(
            anchorRect.left + anchorRect.width / 2 - left,
            (width ?? 0) - 18,
          ),
        )
      : null;

    setPos({
      measuring: false,
      placeUp,
      left,
      width,
      maxHeight,
      arrowLeft,
      top: placeUp ? null : placementRect.bottom + placementGap,
      bottom: placeUp ? vh - placementRect.top + placementGap : null,
    });
    // `measuring` is a dependency so the fit variant gets a second pass once
    // the card is in the DOM and can report its own width.
  }, [
    open,
    anchorRef,
    boundsSelector,
    minSpace,
    isFit,
    isRow,
    pos?.measuring,
  ]);

  useEffect(() => {
    if (!open) return;

    const close = () => onRequestClose?.();
    const onKey = (e) => {
      if (e.key === "Escape") onRequestClose?.();
    };

    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    document.addEventListener("keydown", onKey, true);

    return () => {
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onRequestClose]);

  if (!open || !pos) return null;

  const style = { ...customStyle, left: `${pos.left}px` };

  if (pos.measuring) {
    style.top = "-9999px";
    style.visibility = "hidden";
  } else {
    if (pos.width != null) style.width = `${pos.width}px`;
    if (pos.maxHeight != null) style.maxHeight = `${pos.maxHeight}px`;
    if (pos.arrowLeft != null) {
      style["--hover-arrow-left"] = `${pos.arrowLeft}px`;
    }
    if (pos.placeUp) style.bottom = `${pos.bottom}px`;
    else style.top = `${pos.top}px`;
  }

  if (interactive) style.pointerEvents = "auto";

  return createPortal(
    <div
      ref={cardRef}
      className={`hover-card ${pos.placeUp ? "place-up" : ""} ${className}`}
      style={style}
      role="tooltip"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </div>,
    document.body,
  );
}

export default HoverCard;
