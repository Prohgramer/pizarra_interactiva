import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { navigate } from '../lib/router';

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string;
}

/**
 * Enlace interno: navega sin recargar la página, pero respeta Ctrl/⌘/Mayús y
 * el clic medio (abrir en otra pestaña), porque sigue siendo un <a href> real.
 */
export function Link({ to, onClick, ...props }: LinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };

  return <a href={to} onClick={handleClick} {...props} />;
}
