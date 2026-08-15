import { useRef } from "react";
import HoverCard, { useHoverIntent } from "./HoverCard.jsx";

/**
 * Icon button with a portal tooltip.
 *
 * Uses `aria-disabled` rather than `disabled` when a tip has to stay
 * reachable: WebKit fires no pointer events on a disabled control, which is
 * why the native `title` on a greyed-out button never appeared.
 */
function TipButton({
  tip,
  className = "",
  children,
  onClick,
  disabled = false,
  softDisabled = false,
  ariaLabel,
  ...rest
}) {
  const ref = useRef(null);
  const { open, show, hide, hideNow } = useHoverIntent({
    enabled: Boolean(tip) && !disabled,
    openDelay: 420,
  });

  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`${className} ${softDisabled ? "soft-disabled" : ""}`}
        aria-label={ariaLabel}
        disabled={disabled}
        aria-disabled={softDisabled || undefined}
        onClick={(e) => {
          hideNow();
          onClick?.(e);
        }}
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hideNow}
        {...rest}
      >
        {children}
      </button>

      <HoverCard
        anchorRef={ref}
        open={open}
        variant="fit"
        className="tip"
        onRequestClose={hideNow}
      >
        {tip}
      </HoverCard>
    </>
  );
}

export default TipButton;
