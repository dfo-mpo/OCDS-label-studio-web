import { Children, cloneElement, forwardRef, useCallback } from "react";
import { useCopyText } from "../../hooks/useCopyText";
import { Tooltip } from "@humansignal/ui";

export const CopyableTooltip = forwardRef(({ children, title, textForCopy, onClick, ...restProps }, ref) => {
  const [copied, copyText] = useCopyText({ defaultText: textForCopy });

  const clickHandler = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    copyText();
    if (onClick) onClick(e); // invoke external onClick handler
  }, [copyText, onClick]);

  const child = Children.only(children);
  const clone = cloneElement(child, {
    ...child.props,
    ref,
    onClick: clickHandler,
  });

  return <Tooltip title={copied ? "Copied!" : title} {...restProps}>{clone}</Tooltip>;
});

